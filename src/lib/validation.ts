/**
 * Shared client/server validation for signup & profile fields.
 * Phone: 10-digit Indian mobile — accepts +91 / 0 prefixes and separators,
 * normalizes to the bare 10-digit number.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizePhone(raw: string): string {
  let digits = (raw || "").replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function parsePhone(raw: string): string | null {
  const digits = normalizePhone(raw);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

export function phoneIssue(raw: string): string | null {
  const digits = normalizePhone(raw);
  if (!digits) return "Phone number is required";
  if (digits.length !== 10) return "Enter a 10-digit mobile number";
  if (!/^[6-9]/.test(digits)) return "Indian mobile numbers start with 6, 7, 8 or 9";
  return null;
}

export function nameIssue(name: string): string | null {
  const n = (name || "").trim();
  if (!n) return "Name is required";
  if (n.length < 2) return "Name looks too short";
  if (n.length > 80) return "Name looks too long";
  return null;
}

export function emailIssue(email: string): string | null {
  const e = (email || "").trim().toLowerCase();
  if (!e) return "Email is required";
  if (!EMAIL_RE.test(e)) return "Enter a valid email address";
  return null;
}

export function passwordIssue(password: string): string | null {
  if (!password) return "Password is required";
  if (password.length < 6) return "Use at least 6 characters";
  return null;
}
