import { OrbitBrand } from "@orbit/ui-kit";

export function BriefPlaceholder() {
  return (
    <main className="orbit-page orbit-stack">
      <OrbitBrand compact tagline="Healthcare performance platform" />
      <section className="orbit-card orbit-stack">
        <p className="orbit-meta">Morning Brief</p>
        <h1 className="orbit-page-title">Your Orbit workspace is being prepared.</h1>
        <p className="orbit-text-muted">
          Authentication is active. Role and scope will be loaded from the verified membership boundary in the next integration slice.
        </p>
        <div className="orbit-disclosure-banner">
          <span>Illustrative environment</span>
          <span>Fictional demonstration company. No operational data is displayed.</span>
        </div>
      </section>
    </main>
  );
}
