import { useRef, useEffect } from "react";

interface Props {
  checked: boolean;
  onChange: () => void;
  indeterminate?: boolean;
}

export function Checkbox({ checked, onChange, indeterminate }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate ?? false;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox"
      checked={checked}
      onChange={onChange}
    />
  );
}
