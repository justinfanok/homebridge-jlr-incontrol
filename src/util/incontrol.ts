import { ENGINE_METHOD_DIGESTS } from "constants";
import { METHODS } from "http";

const rpn = require("request-promise-native");

const vehicleInformationAccepts = {
  status: "application/vnd.ngtp.org.if9.healthstatus-v2+json",
  attributes: "application/vnd.ngtp.org.VehicleAttributes-v3+json",
};

export async function incontrol(
  method: string,
  endpoint: string,
  headers: any,
  json: any = {},
  resolveWithFullResponse: boolean = false,
): Promise<any> {
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
}

export async function getVehicleInformation(
  name: string,
  vin: string,
  accessToken: string,
  deviceId: string,
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: vehicleInformationAccepts[name],
    "Content-Type": "application/json",
    "X-Device-Id": deviceId,
  };

  return await incontrol(
    "GET",
    `https://jlp-ifoa.wirelesscar.net/if9/jlr/vehicles/${vin}/${name}`,
    headers,
  );
}
