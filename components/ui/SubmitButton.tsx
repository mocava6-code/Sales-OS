"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./Button";

export function SubmitButton({
  children,
  pendingText,
  variant,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}
