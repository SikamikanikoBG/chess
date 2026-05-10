import bcrypt from 'bcryptjs';

// Cost 12 ≈ ~250 ms per hash on a modern desktop CPU; an attacker with a
// stolen DB grinds at ~5–10 hashes/sec/core on a GPU. Bumped from 10 (which
// was the 2014 default) for v3.0 because the app is open-sourced and self-
// hosted, so DBs may end up on shared/unattended boxes.
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
