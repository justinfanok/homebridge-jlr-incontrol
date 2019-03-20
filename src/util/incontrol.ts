import { ENGINE_METHOD_DIGESTS } from "constants";
import { METHODS } from "http";

const rpn = require("request-promise-native");

export default async function incontrol(
  method: string,
  endpoint: string,
  headers: any,
  body: any | null,
): Promise<any> {
  try {
    const request = {
      method: method,
      uri: endpoint,
      headers: headers,
      body: body,
    };
    return await rpn(request);
  } catch (error) {
    if (typeof error === "string") {
      throw new Error(error);
    }

    throw error;
  }
}
