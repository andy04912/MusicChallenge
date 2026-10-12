import { useEffect, useRef } from "react";
export default function SelectionCheckbox({
  checked,
  mixed,
  onChange,
  children,
  disabled,
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.indeterminate = !!mixed;
  }, [mixed]);
  return (
    <label className="checkbox-label">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {children}
    </label>
  );
}
