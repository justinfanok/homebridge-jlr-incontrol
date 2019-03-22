import { VehicleStatusResponse, VehicleStatus } from "./types";
import { lock } from "./mutex";

const rpn = require("request-promise-native");

type Authentication = {
  accessToken: string;
  authorizationToken: string;
  expiresIn: number;
  refreshToken: string;
  tokenType: string;
  isDeviceRegistered: boolean;
  isLoggedIn: boolean;
};

export class InControlService {
  private log: any;
  private username: string;
  private password: string;
  private deviceId: string;
  private vin: string;
  private pin: string;
  private auth: Authentication | undefined;

  private static readonly vehicleInformationAccepts = {
    status: "application/vnd.ngtp.org.if9.healthstatus-v2+json",
    attributes: "application/vnd.ngtp.org.VehicleAttributes-v3+json",
  };

  constructor(
    log: any,
    username: string,
    password: string,
    deviceId: string,
    vin: string,
    pin: string,
  ) {
    this.log = log;
    this.username = username;
    this.password = password;
    this.deviceId = deviceId;
    this.vin = vin;
    this.pin = pin;
  }

  private sendRequest = async (
    method: string,
    endpoint: string,
    headers: any,
    json: any = {},
    resolveWithFullResponse: boolean = false,
  ): Promise<any> => {
    try {
      const request = {
        method: method,
        uri: endpoint,
        headers: headers,
        json: json,
        resolveWithFullResponse: resolveWithFullResponse,
      };
      return await rpn(request);
    } catch (error) {
      if (typeof error === "string") {
        throw new Error(error);
      }

      throw error;
    }
  };

  private getSession = async (): Promise<Authentication> => {
    // Use a mutex to prevent multiple logins happening in parallel.
    const unlock = await lock("getSession", 20000);

    try {
      if (this.auth) {
        this.log("Getting active session");
        return this.auth;
      }

      this.log("Starting new session");

      this.auth = await this.authenticate();
      this.auth.isDeviceRegistered = await this.registerDevice();
      this.auth.isLoggedIn = await this.login();

      return this.auth;
    } finally {
      unlock();
    }
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

    const result = await this.sendRequest(
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

    this.log("Got an authentication token.");

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

    const result = await this.sendRequest(
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

    const result = await this.sendRequest(
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

  private getVehicleInformation = async (name: string): Promise<any> => {
    const { vin, deviceId } = this;
    const auth = await this.getSession();

    this.log("Getting vehicle", name, vin);

    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: InControlService.vehicleInformationAccepts[name],
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
    };

    return await this.sendRequest(
      "GET",
      `https://jlp-ifoa.wirelesscar.net/if9/jlr/vehicles/${vin}/${name}`,
      headers,
    );
  };

  getVehicleAttributes = async () => {
    return await this.getVehicleInformation("attributes");
  };

  getVehicleStatus = async (): Promise<VehicleStatus> => {
    const response: VehicleStatusResponse = await this.getVehicleInformation(
      "status",
    );

    var vehicleStatus: VehicleStatus = {};

    response.vehicleStatus.map(kvp => (vehicleStatus[kvp.key] = kvp.value));

    return vehicleStatus;
  };

  lockVehicle = async (): Promise<any> => {};

  unlockVehicle = async (): Promise<any> => {};
}
