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

class JaguarLandRoverAccessory {
  // From config.
  log: Function;
  name: string;
  vin: string;
  waitMinutes: number;
  lowBatteryThreshold: number;
  targetTemperature: number;
  coolingThresholdTemperature: number;

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
    this.targetTemperature = config["targetTemperature"] || 21;
    this.coolingThresholdTemperature =
      config["coolingThresholdTemperature"] || 20;
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

    const preconditioningService = new Service.Thermostat(
      `${this.name} Preconditioning`,
      "vehicle",
    );
    preconditioningService
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on("get", callbackify(this.getCurrentHeatingCoolingState));
    preconditioningService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on("get", callbackify(this.getTargetHeatingCoolingState))
      .on("set", callbackify(this.setTargetHeatingCoolingState));
    preconditioningService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on("get", callbackify(this.getCurrentTemperature));
    preconditioningService
      .getCharacteristic(Characteristic.TargetTemperature)
      .on("get", callbackify(this.getTargetTemperature))
      .on("set", callbackify(this.setTargetTemperature));
    preconditioningService
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on("get", callbackify(this.getTemperatureDisplayUnits));
    this.preconditioningService = preconditioningService;
  }

  getServices() {
    const { batteryService, lockService, preconditioningService } = this;
    return [batteryService, lockService, preconditioningService];
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

    return lockedState === "TRUE"
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  };

  getLockTargetState = async () => {
    return await this.getLockCurrentState();
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

  //
  // Preconditioning
  //

  getCurrentHeatingCoolingState = async () => {
    //const vehicleStatus = await this.incontrol.getVehicleStatus();
    const climateStatus = "ON"; //vehicleStatus.CLIMATE_STATUS_OPERATING_STATUS;

    const climateOnState =
      this.targetTemperature < this.coolingThresholdTemperature
        ? Characteristic.CurrentHeatingCoolingState.COOL
        : Characteristic.CurrentHeatingCoolingState.HEAT;

    return climateStatus === "ON"
      ? climateOnState
      : Characteristic.CurrentHeatingCoolingState.OFF;
  };

  getTargetHeatingCoolingState = async () => {
    return await this.getCurrentHeatingCoolingState();
  };

  setTargetHeatingCoolingState = async state => {
    this.log("Set heating cooling state to", state);

    if (state === Characteristic.CurrentHeatingCoolingState.OFF) {
      await this.incontrol.startPreconditioning(this.targetTemperature);
    } else {
      await this.incontrol.stopPreconditioning();
    }

    // We succeeded, so update the "current" state as well.
    // We need to update the current state "later" because Siri can't
    // handle receiving the change event inside the same "set target state"
    // response.
    await wait(1);

    return state;
  };

  getCurrentTemperature = async () => {
    return this.targetTemperature;
  };

  getTargetTemperature = async () => {
    return this.targetTemperature;
  };

  setTargetTemperature = async state => {
    this.targetTemperature = state;

    // if we're currently preconditioning, then send the update to the car
    if (
      (await this.getCurrentHeatingCoolingState()) !==
      Characteristic.CurrentHeatingCoolingState.OFF
    )
      await this.setTargetHeatingCoolingState(
        Characteristic.TargetHeatingCoolingState.AUTO,
      );

    // We succeeded, so update the "current" state as well.
    // We need to update the current state "later" because Siri can't
    // handle receiving the change event inside the same "set target state"
    // response.
    await wait(1);

    return Characteristic.TargetHeatingCoolingState.AUTO;
  };

  getTemperatureDisplayUnits = async () => {
    return Characteristic.TemperatureDisplayUnits.CELSIUS;
  };
}
