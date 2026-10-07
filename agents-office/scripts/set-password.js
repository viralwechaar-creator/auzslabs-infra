// Makes the password hash and session secret for your env file. The password itself is never stored.
import readline from 'node:readline';
import crypto from 'node:crypto';
import { hashPassword } from '../lib/auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Choose your Agents Office password (12+ characters): ', (pw) => {
  rl.close();
  if (pw.length < 12) { console.error('Too short. Use at least 12 characters.'); process.exit(1); }
  console.log('\nAdd these two lines to your env file (.env locally, /etc/auzslab-agents-office.env on the server):\n');
  console.log('OFFICE_PASSWORD_HASH=' + hashPassword(pw));
  console.log('OFFICE_SESSION_SECRET=' + crypto.randomBytes(32).toString('hex'));
});
