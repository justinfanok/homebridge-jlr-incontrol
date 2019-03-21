import { ENGINE_METHOD_DIGESTS } from "constants";
import { METHODS } from "http";

const rpn = require("request-promise-native");

export default async function incontrol(
  method: string,
  endpoint: string,
  headers: any,
  json: any | null,
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
