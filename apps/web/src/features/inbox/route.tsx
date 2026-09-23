import type { Exception, InboxResponse } from "@orbit/contracts";
import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { humanize } from "../../lib/format";
import { Disclosure, ExceptionCard, SurfaceHeading } from "../workspace/components";
import { useWorkspacePath, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "./inbox.css";

export function inboxLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<InboxResponse> => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return withClient(environment, request, (client) => client.inbox(cursor));
  };
}

const PRIORITIES = ["act_now", "monitor"] as const satisfies readonly Exception["priority"][];
const CATEGORIES = ["safety", "legal", "compliance", "performance"] as const satisfies readonly Exception["category"][];

function matches(item: Exception, priority: string | null, category: string | null) {
  return (!priority || item.priority === priority) && (!category || item.category === category);
}

export function InboxPage({ inbox }: { inbox: InboxResponse }) {
  const [search] = useSearchParams();
  const path = useWorkspacePath();
  const priority = search.get("priority");
  const category = search.get("category");
  const cursor = search.get("cursor");
  const visible = inbox.items.filter((item) => matches(item, priority, category));
  const filtered = visible.length !== inbox.items.length;
  const actNow = inbox.items.filter((item) => item.priority === "act_now").length;
  const withAction = inbox.items.filter((item) => item.actionState !== "none").length;

  return (
    <>
      <title>Priority inbox | Orbit</title>
      <SurfaceHeading
        eyebrow="Priority inbox"
        title="Exceptions in your authorized scope"
        description="Every exception names its source, scope, period, accountable owner, and action state. Open the evidence before recording a decision."
        aside={
          <dl className="inbox-counts" aria-label="Inbox counts">
            <div>
              <dt>On this page</dt>
              <dd className="is-illustrative">{inbox.items.length}</dd>
            </div>
            <div>
              <dt>Act now</dt>
              <dd className="is-illustrative">{actNow}</dd>
            </div>
            <div>
              <dt>With an action</dt>
              <dd className="is-illustrative">{withAction}</dd>
            </div>
          </dl>
        }
      />

      <Disclosure text={inbox.disclosure} />

      <div className="inbox-toolbar">
        <p className="inbox-ordering">
          <strong>How this list is ordered</strong>
          <span>{inbox.orderingBasis}</span>
        </p>
        <Form className="inbox-filters" method="get" aria-label="Filter the inbox">
          {cursor ? <input type="hidden" name="cursor" value={cursor} /> : null}
          <label className="orbit-field">
            <span className="orbit-field-label">Priority</span>
            <select className="orbit-select" name="priority" defaultValue={priority ?? ""}>
              <option value="">All priorities</option>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>{humanize(value)}</option>
              ))}
            </select>
          </label>
          <label className="orbit-field">
            <span className="orbit-field-label">Category</span>
            <select className="orbit-select" name="category" defaultValue={category ?? ""}>
              <option value="">All categories</option>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>{humanize(value)}</option>
              ))}
            </select>
          </label>
          <button className="orbit-button" data-variant="secondary" type="submit">Apply</button>
          {filtered || priority || category ? (
            <Link className="orbit-button" data-variant="quiet" to={path("/inbox")}>Clear</Link>
          ) : null}
        </Form>
      </div>

      {filtered ? (
        <output className="inbox-filter-note">
          Showing {visible.length} of {inbox.items.length} authorized exceptions on this page. Filters only narrow what you
          are already authorized to see.
        </output>
      ) : null}

      <div className="exception-list">
        {visible.length ? (
          visible.map((item) => <ExceptionCard key={item.exceptionId} item={item} />)
        ) : (
          <p className="workspace-empty">
            {inbox.items.length ? "No exceptions match these filters." : "No exceptions were returned for your scope."}
          </p>
        )}
      </div>

      {inbox.nextCursor || cursor ? (
        <nav className="inbox-pagination" aria-label="Inbox pages">
          {cursor ? (
            <Link className="orbit-button" data-variant="secondary" to={path("/inbox")}>First page</Link>
          ) : null}
          {inbox.nextCursor ? (
            <Link
              className="orbit-button"
              data-variant="secondary"
              to={`${path("/inbox")}?${new URLSearchParams({ cursor: inbox.nextCursor }).toString()}`}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

export function InboxRoute() {
  return <InboxPage inbox={useLoaderData<InboxResponse>()} />;
}
