// One-time: makes the signing key pair for AUZsStyle licence codes.
//   node tools/licence-keygen.mjs
// Put LICENCE_PRIVATE_KEY in the server .env (never anywhere else, never in git, keep a password-manager copy: if it is lost no new
// codes can be made for installs that hold the old public key). Give the LICENCE_PUBLIC_KEY line to the installer build.
import { makeKeypair } from '../server/src/licence.js';
const k = makeKeypair();
console.log(`LICENCE_PRIVATE_KEY='${k.priv}'`);
console.log(`LICENCE_PUBLIC_KEY='${k.pub}'`);
