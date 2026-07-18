import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const variantClasses: Record<Variant, string> = {
  primary: "bg-neutral-900 text-white active:bg-neutral-700 disabled:bg-neutral-300",
  secondary:
    "bg-white text-neutral-900 border border-neutral-300 active:bg-neutral-100 disabled:text-neutral-400",
  danger: "bg-red-600 text-white active:bg-red-700 disabled:bg-red-200",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`w-full rounded-xl px-4 py-3 text-base font-medium transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
