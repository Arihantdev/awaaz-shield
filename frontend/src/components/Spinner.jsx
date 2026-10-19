/** Small inline loading indicator for buttons. Decorative: the button carries aria-busy. */
export default function Spinner({ size = 14 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}
