require("@babel/polyfill");
import { ClimateState, Vehicle, VehicleState, VehicleData } from "./util/types";
import { wait } from "./util/wait";
import incontrol from "./util/incontrol";
import { lock } from "./util/mutex";
import callbackify from "./util/callbackify";

const util = require("util");

let Service: any, Characteristic: any;

export default function(homebridge: any) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    "homebridge-jlr-incontrol",
    "Jaguar Land Rover",
    JaguarLandRoverAccessory,
  );
}

type Authentication = {
  accessToken: string;
  authorizationToken: string;
  expiresIn: number;
  refreshToken: string;
  tokenType: string;
  isDeviceRegistered: boolean;
  isLoggedIn: boolean;
};

export class JaguarLandRoverAccessory {
  // From config.
  log: Function;
  name: string;
  vin: string;
  username: string;
  password: string;
  deviceId: string;
  waitMinutes: number;

  // Runtime state.
  auth: Authentication | undefined;
  vehicleID: string | undefined;

  // Services exposed.
  lockService: any;
  preconditioningService: any;

  constructor(log: any, config: any) {
    this.log = log;
    this.name = config["name"];
    this.vin = config["vin"];
    this.username = config["username"];
    this.password = config["password"];
    this.waitMinutes = config["waitMinutes"] || 1; // default to one minute.
    this.deviceId = config["deviceId"];

    const lockService = new Service.LockMechanism(this.name, "vehicle");

    lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .on("get", callbackify(this.getLockCurrentState));

    lockService
      .getCharacteristic(Characteristic.LockTargetState)
      .on("get", callbackify(this.getLockTargetState))
      .on("set", callbackify(this.setLockTargetState));

    this.lockService = lockService;

    const preconditioningService = new Service.Switch(this.name);

    preconditioningService
      .getCharacteristic(Characteristic.On)
      .on("get", callbackify(this.getClimateOn))
      .on("set", callbackify(this.setClimateOn));

    this.preconditioningService = preconditioningService;
  }

  getServices() {
    const { lockService, preconditioningService } = this;
    return [lockService, preconditioningService];
  }

  //
  // Vehicle Lock
  //

  getLockCurrentState = async () => {
    const options = await this.getOptions();

    // This will only succeed if the car is already online. We don't want to
    // wake it up just to see if climate is on because that could drain battery!
    const state: VehicleState = await incontrol("vehicleState", options);

    return state.locked
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  };

  getLockTargetState = async () => {
    const options = await this.getOptions();

    // This will only succeed if the car is already online. We don't want to
    // wake it up just to see if climate is on because that could drain battery!
    const state: VehicleState = await incontrol("vehicleState", options);

    return state.locked
      ? Characteristic.LockTargetState.SECURED
      : Characteristic.LockTargetState.UNSECURED;
  };

  setLockTargetState = async state => {
    const options = await this.getOptions();

    // Wake up, this is important!
    await this.wakeUp();

    this.log("Set lock state to", state);

    if (state === Characteristic.LockTargetState.SECURED) {
      await incontrol("doorLock", options);
    } else {
      await incontrol("doorUnlock", options);
    }

    // We succeeded, so update the "current" state as well.
    // We need to update the current state "later" because Siri can't
    // handle receiving the change event inside the same "set target state"
    // response.
    await wait(1);

    if (state == Characteristic.LockTargetState.SECURED) {
      this.lockService.setCharacteristic(
        Characteristic.LockCurrentState,
        Characteristic.LockCurrentState.SECURED,
      );
    } else {
      this.lockService.setCharacteristic(
        Characteristic.LockCurrentState,
        Characteristic.LockCurrentState.UNSECURED,
      );
    }
  };

  //
  // Climate Switch
  //

  getClimateOn = async () => {
    const options = await this.getOptions();

    // This will only succeed if the car is already online. We don't want to
    // wake it up just to see if climate is on because that could drain battery!
    const state: ClimateState = await incontrol("climateState", options);

    const on = state.is_auto_conditioning_on;

    this.log("Climate on?", on);
    return on;
  };

  setClimateOn = async on => {
    const options = await this.getOptions();

    // Wake up, this is important!
    await this.wakeUp();

    this.log("Set climate to", on);

    if (on) {
      await incontrol("climateStart", options);
    } else {
      await incontrol("climateStop", options);
    }
  };

  //
  // General
  //

  getOptions = async (): Promise<{ authToken: string; vehicleID: string }> => {
    // Use a mutex to prevent multiple logins happening in parallel.
    const unlock = await lock("getOptions", 20000);

    try {
      // First login if we don't have a token.
      const authToken = await this.authenticate();

      // Grab the string ID of your vehicle.
      const { id_s: vehicleID } = await this.getVehicle();

      return { authToken, vehicleID };
    } finally {
      unlock();
    }
  };

  getSession = async (): Promise<Authentication> => {
    if (this.auth) return this.auth;

    this.auth = await this.authenticate();
    this.auth.isDeviceRegistered = await this.registerDevice();
    this.auth.isLoggedIn = await this.login();

    return this.auth;
  };

  private authenticate = async (): Promise<Authentication> => {
    const { username, password, auth, deviceId } = this;

    // Return cached value if we have one.
    if (auth) return auth;

    this.log("Authenticating with InControl API using credentials");

    const headers = {
      "Content-Type": "application/json",
      Authorization: "Basic YXM6YXNwYXNz ",
      "X-Device-Id": deviceId,
      Connection: "close",
    };
    const json = {
      grant_type: "password",
      password: password,
      username: username,
    };

    const result = await incontrol(
      "POST",
      "https://jlp-ifas.wirelesscar.net/ifas/jlr/tokens",
      headers,
      json,
    );
    const {
      access_token,
      authorization_token,
      refresh_token,
      expires_in,
      token_type,
    } = result;

    this.log("Got a login token.");

    return {
      accessToken: access_token,
      authorizationToken: authorization_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      tokenType: token_type,
      isDeviceRegistered: false,
      isLoggedIn: false,
    };
  };

  private registerDevice = async (): Promise<boolean> => {
    const { username, auth, deviceId } = this;

    // Return cached value if we have one.
    if (auth && auth.isDeviceRegistered) return auth.isDeviceRegistered;

    this.log("Registering device", deviceId);
    const headers = {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      Connection: "close",
    };
    const json = {
      access_token: auth.accessToken,
      authorization_token: auth.authorizationToken,
      expires_in: auth.expiresIn,
      deviceID: deviceId,
    };

    const result = await incontrol(
      "POST",
      `https://jlp-ifop.wirelesscar.net/ifop/jlr/users/${username}/clients`,
      headers,
      json,
      true,
    );

    const isDeviceRegistered = result.statusCode === 204;
    this.log("Device registration result", isDeviceRegistered);

    return isDeviceRegistered;
  };

  private login = async (): Promise<boolean> => {
    const { username, auth, deviceId } = this;

    // Return cached value if we have one.
    if (auth && auth.isLoggedIn) return auth.isLoggedIn;

    this.log("Logging user in ", username);
    const headers = {
      Accept: "application/vnd.wirelesscar.ngtp.if9.User-v3+json",
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      Connection: "close",
    };

    const result = await incontrol(
      "GET",
      `https://jlp-ifoa.wirelesscar.net/if9/jlr/users?loginName=${username}`,
      headers,
      undefined,
      true,
    );

    const isLoggedIn = result.statusCode === 200;
    this.log("Log in result", isLoggedIn);

    return isLoggedIn;
  };

  getVehicle = async () => {
    const { vin } = this;

    // Only way to do this is to get ALL vehicles then filter out the one
    // we want.
    const authToken = await this.authenticate();
    const vehicles: Vehicle[] = await incontrol("allVehicles", { authToken });

    // Now figure out which vehicle matches your VIN.
    // `vehicles` is something like:
    // [ { id_s: '18488650400306554', vin: '5YJ3E1EA8JF006024', state: 'asleep', ... }, ... ]
    const vehicle = vehicles.find(v => v.vin === vin);

    if (!vehicle) {
      this.log(
        "No vehicles were found matching the VIN ${vin} entered in your config.json. Available vehicles:",
      );
      for (const vehicle of vehicles) {
        this.log("${vehicle.vin} [${vehicle.display_name}]");
      }

      throw new Error(`Couldn't find vehicle with VIN ${vin}.`);
    }

    this.log(
      `Using vehicle "${vehicle.display_name}" with state "${vehicle.state}"`,
    );

    return vehicle;
  };

  wakeUp = async () => {
    const options = await this.getOptions();

    // Send the command.
    await incontrol("wakeUp", options);

    // Wait up to 30 seconds for the car to wake up.
    const start = Date.now();
    let waitTime = 1000;

    while (Date.now() - start < this.waitMinutes * 60 * 1000) {
      // Poll InControl for the latest on this vehicle.
      const { state } = await this.getVehicle();

      if (state === "online") {
        // Success!
        return;
      }

      this.log("Waiting for vehicle to wake up…");
      await wait(waitTime);

      // Use exponential backoff with a max wait of 5 seconds.
      waitTime = Math.min(waitTime * 2, 5000);
    }

    throw new Error(
      `Vehicle did not wake up within ${this.waitMinutes} minutes.`,
    );
  };
}
