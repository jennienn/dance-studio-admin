import { describe, expect, it } from "vitest";
import { mapEnrollmentRpcError } from "@/lib/enrollment-service";

describe("수강 등록 RPC 오류 변환", () => {
  it("회원 전화번호 고유 제약 위반을 중복 연락처 오류로 안내한다", () => {
    expect(
      mapEnrollmentRpcError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "idx_members_phone_digits_unique"'
      })
    ).toEqual({
      ok: false,
      status: 409,
      code: "DUPLICATE_PHONE",
      message: "이미 등록된 연락처입니다. 기존 회원에서 수강권을 추가해주세요."
    });
  });
});
