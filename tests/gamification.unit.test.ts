import { levelFor, XP } from '../src/modules/gamification/service';
import { linkedinAddToProfileUrl } from '../src/modules/certificates/service';

describe('gamification levels', () => {
  it('level 1 at 0 XP', () => {
    expect(levelFor(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 100 });
  });
  it('level rises every 100 XP', () => {
    expect(levelFor(250).level).toBe(3);
    expect(levelFor(250).xpIntoLevel).toBe(50);
  });
  it('XP table has positive values', () => {
    for (const v of Object.values(XP)) expect(v).toBeGreaterThan(0);
  });
});

describe('LinkedIn add-to-profile URL', () => {
  it('builds a deep link with cert details', () => {
    const url = linkedinAddToProfileUrl({
      title: 'Full-Stack Web Development',
      certificateNo: 'GUMI-2026-000001',
      issuedAt: new Date('2026-03-15T00:00:00Z'),
      verifyUrl: 'https://gi.example/verify/GUMI-2026-000001',
    });
    expect(url).toContain('linkedin.com/profile/add');
    expect(url).toContain('startTask=CERTIFICATION_NAME');
    expect(url).toContain('certId=GUMI-2026-000001');
    expect(url).toContain('issueYear=2026');
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain('GI Internship');
  });
});
