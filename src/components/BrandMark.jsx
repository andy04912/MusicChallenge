export default function BrandMark({ className = "" }) {
  return (
    <img
      className={`brand-mark ${className}`.trim()}
      src="/images/music-challenge-mark.svg"
      width="48"
      height="48"
      alt=""
      aria-hidden="true"
    />
  );
}
