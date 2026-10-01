import { Link } from "react-router";
import { Icon } from "../workspace/components";

/** A plain back link for ERP pages (the leader workspace's back button needs the leader workspace). */
export function ErpBack({ to }: { to: string }) {
  return (
    <Link className="workspace-back erp-back" to={to}>
      <Icon name="arrow" />
      Back
    </Link>
  );
}
