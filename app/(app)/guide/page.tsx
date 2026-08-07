export const dynamic = "force-dynamic";

/**
 * Manager's Guide, embedded inside the app shell. The guide itself is the
 * static page at public/guide/index.html (also reachable directly, no login,
 * for sharing with managers who aren't in the app yet).
 */
export default function GuidePage() {
  return (
    <div className="card overflow-hidden" style={{ height: "calc(100vh - 76px)" }}>
      <iframe
        src="/guide/index.html"
        title="Manager's Guide"
        className="w-full h-full border-0"
      />
    </div>
  );
}
