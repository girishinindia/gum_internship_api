import { signupSchema, passwordSchema, phoneSchema } from '../src/modules/auth/schemas';
import { encryptSecret, decryptSecret, generateOtp, hashOtp } from '../src/services/crypto';

describe('auth schemas', () => {
  it('rejects weak passwords (no number)', () => {
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('Password123').success).toBe(true);
  });

  it('normalizes bare 10-digit phones to +91', () => {
    expect(phoneSchema.parse('9800000010')).toBe('+919800000010');
    expect(phoneSchema.parse('+919800000010')).toBe('+919800000010');
  });

  it('signup requires all identity fields', () => {
    const r = signupSchema.safeParse({ email: 'a@b.in', password: 'Password1' });
    expect(r.success).toBe(false);
  });
});

describe('crypto service', () => {
  it('AES-256-GCM round-trips and tamper fails', () => {
    const enc = encryptSecret('ABCDE1234F');
    expect(enc).not.toContain('ABCDE1234F');
    expect(decryptSecret(enc)).toBe('ABCDE1234F');
    const [iv, tag, data] = enc.split(':');
    expect(() => decryptSecret(`${iv}:${tag}:${'00'}${data!.slice(2)}`)).toThrow();
  });

  it('OTP is 6 digits and hash is destination-salted', () => {
    const code = generateOtp();
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(hashOtp('a@b.in', code)).not.toBe(hashOtp('c@d.in', code));
  });
});
