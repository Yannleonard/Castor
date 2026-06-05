// ui/src/components/Field.tsx — labeled input/select/textarea helpers.
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

interface FieldWrapProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export function FieldWrap({ label, hint, error, htmlFor, children }: FieldWrapProps) {
  return (
    <div className="field">
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, mono, id, className, ...rest },
  ref,
) {
  const fieldId = id || rest.name || undefined;
  return (
    <FieldWrap label={label} hint={hint} error={error} htmlFor={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        className={`input${mono ? " input-mono" : ""}${className ? ` ${className}` : ""}`}
        {...rest}
      />
    </FieldWrap>
  );
});

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function SelectField({ label, hint, error, id, children, ...rest }: SelectFieldProps) {
  const fieldId = id || rest.name || undefined;
  return (
    <FieldWrap label={label} hint={hint} error={error} htmlFor={fieldId}>
      <select id={fieldId} className="select" {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function TextAreaField({ label, hint, error, id, ...rest }: TextAreaFieldProps) {
  const fieldId = id || rest.name || undefined;
  return (
    <FieldWrap label={label} hint={hint} error={error} htmlFor={fieldId}>
      <textarea id={fieldId} className="textarea" {...rest} />
    </FieldWrap>
  );
}
