/**
 * 简单 UUID v7 生成器
 *
 * 不引第三方库 — 实现一个最小可用的 v7。规范关键:前 48 bit 是 unix ms,
 * 接下来 4 bit version=7,12 bit rand;再后 2 bit variant=10,62 bit rand。
 *
 * 性能上完全够用(每次 push 生成 N 条),不要替换为 crypto.randomUUID() —
 * randomUUID 是 v4,没有时序信息。
 */
import { randomBytes } from 'crypto';

export function uuidV7(): string {
  const ms = Date.now();
  const buf = randomBytes(16);

  // 前 6 字节 = 48 bit ms timestamp(big endian)
  buf[0] = (ms / 0x10000000000) & 0xff;
  buf[1] = (ms / 0x100000000) & 0xff;
  buf[2] = (ms >>> 24) & 0xff;
  buf[3] = (ms >>> 16) & 0xff;
  buf[4] = (ms >>> 8) & 0xff;
  buf[5] = ms & 0xff;

  // 第 7 字节高 4 位 = version 0b0111
  buf[6] = (buf[6] & 0x0f) | 0x70;
  // 第 9 字节高 2 位 = variant 0b10
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const hex = buf.toString('hex');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
