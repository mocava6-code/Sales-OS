import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const inputClasses =
  "w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none";

function FieldLabel({ label, htmlFor }: { label: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-neutral-700">
      {label}
    </label>
  );
}

export function TextField({
  label,
  id,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; error?: string }) {
  return (
    <div>
      <FieldLabel label={label} htmlFor={id} />
      <input id={id} name={id} className={inputClasses} {...props} />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function TextAreaField({
  label,
  id,
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string; error?: string }) {
  return (
    <div>
      <FieldLabel label={label} htmlFor={id} />
      <textarea id={id} name={id} className={inputClasses} rows={3} {...props} />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function SelectField({
  label,
  id,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; error?: string }) {
  return (
    <div>
      <FieldLabel label={label} htmlFor={id} />
      <select id={id} name={id} className={inputClasses} {...props}>
        {children}
      </select>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
