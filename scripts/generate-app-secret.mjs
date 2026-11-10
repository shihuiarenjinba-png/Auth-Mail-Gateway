import { randomBytes } from "node:crypto";

const secret = randomBytes(48).toString("base64url");

console.log(secret);
