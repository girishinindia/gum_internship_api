/**
 * Eligibility-quiz gate STUB (module 2.4). The quizzes module replaces the
 * implementation; the interface is final. An internship may later declare an
 * eligibility quiz in certificate_rules/eligibility config — until then every
 * enrollment is eligible.
 */
export interface QuizGateResult {
  required: boolean;
  eligible: boolean;
  reason?: string;
}

export interface QuizGateLike {
  checkEnrollmentEligibility(userId: number, internshipId: number): Promise<QuizGateResult>;
}

export const quizGate: QuizGateLike = {
  async checkEnrollmentEligibility(): Promise<QuizGateResult> {
    return { required: false, eligible: true };
  },
};
