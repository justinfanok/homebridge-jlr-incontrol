require("@babel/polyfill");
import { wait } from "./util/wait";
import { InControlService } from "./util/incontrol";
import callbackify from "./util/callbackify";

let Service: any, Characteristic: any;

export default function(homebridge: any) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    "homebridge-jlr-incontrol",
    "Jaguar Land Rover InControl",
    JaguarLandRoverAccessory,
  );
}

export class JaguarLandRoverAccessory {
  // From config.
  log: Function;
  name: string;
  vin: string;
  waitMinutes: number;
  lowBatteryThreshold: number;

  // InControl API interface.
  incontrol: InControlService;

  // HomeKit Services exposed.
  batteryService: any;
  lockService: any;
  preconditioningService: any;

  constructor(log: any, config: any) {
    this.log = log;
    this.name = config["name"];
    this.vin = config["vin"];
    this.waitMinutes = config["waitMinutes"] || 1; // default to one minute.
    this.lowBatteryThreshold = config["lowBatteryThreshold"] || 25;
    this.incontrol = new InControlService(
      log,
      config["username"],
      config["password"],
      config["deviceId"],
      this.vin,
      config["pin"],
    );

    const batteryService = new Service.BatteryService(this.name, "vehicle");
    batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .on("get", callbackify(this.getBatteryLevel));
    batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .on("get", callbackify(this.getChargingState));
    batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .on("get", callbackify(this.getStatusLowBattery));
    this.batteryService = batteryService;

    const lockService = new Service.LockMechanism(this.name, "vehicle");
    lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .on("get", callbackify(this.getLockCurrentState));
    lockService
      .getCharacteristic(Characteristic.LockTargetState)
      .on("get", callbackify(this.getLockTargetState))
      .on("set", callbackify(this.setLockTargetState));
    this.lockService = lockService;
  }

  getServices() {
    const { batteryService, lockService } = this;
    return [batteryService, lockService];
  }

  //
  // Battery
  //

  getBatteryLevel = async (): Promise<number> => {
    const vehicleStatus = await this.incontrol.getVehicleStatus();
    const chargeLevel = vehicleStatus.EV_STATE_OF_CHARGE;

    return chargeLevel;
  };

  getChargingState = async (): Promise<any> => {
    const vehicleStatus = await this.incontrol.getVehicleStatus();
    const chargingStatus = vehicleStatus.EV_CHARGING_STATUS;

    return chargingStatus === "CHARGING"
      ? Characteristic.ChargingState.CHARGING
      : Characteristic.ChargingState.NOT_CHARGING;
  };

  getStatusLowBattery = async (): Promise<any> => {
    const batteryLevel = await this.getBatteryLevel();

    return batteryLevel < this.lowBatteryThreshold;
  };

  //
  // Vehicle Lock
  //

  getLockCurrentState = async () => {
    const vehicleStatus = await this.incontrol.getVehicleStatus();
    const lockedState = vehicleStatus.DOOR_IS_ALL_DOORS_LOCKED;

    this.log("Locked state", lockedState);

    return lockedState === "TRUE"
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  };

  getLockTargetState = async () => {
    const vehicleStatus = await this.incontrol.getVehicleStatus();
    const lockedState = vehicleStatus.DOOR_IS_ALL_DOORS_LOCKED;

    this.log("Locked state", lockedState);

    return lockedState === "TRUE"
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  };

  setLockTargetState = async state => {
    this.log("Set lock state to", state);

    if (state === Characteristic.LockTargetState.SECURED) {
      await this.incontrol.lockVehicle();
    } else {
      await this.incontrol.unlockVehicle();
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
}
