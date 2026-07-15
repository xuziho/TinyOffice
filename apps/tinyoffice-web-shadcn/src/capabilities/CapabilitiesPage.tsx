import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

import { getCapabilities } from "@/api/capabilitiesClient";
import { Badge } from "@/components/ui/badge";
import { SelectionList, SelectionRow, SelectionRowDescription, SelectionRowTitle } from "@/components/product/SelectionList";
import { SectionContentHeader } from "@/app/SectionContentHeader";

export function CapabilitiesPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const [selected, setSelected] = useState("");
  const query = useQuery({ queryKey: ["capabilities", companyId], enabled: Boolean(companyId), queryFn: () => getCapabilities({ companyId }) });
  const active = query.data?.capabilities.find((item) => item.id === selected) ?? query.data?.capabilities[0];
  return <main className="grid h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
    <SectionContentHeader description="System-owned runtime contracts" actions={<Badge className="tiny-page-attribute" variant="secondary"><LockKeyhole />Read only</Badge>} />
    <section className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
      <aside className="overflow-y-auto overflow-x-hidden border-r bg-muted/20 p-2"><SelectionList>{(query.data?.capabilities ?? []).map((item) => <SelectionRow key={item.id} selected={item.id === active?.id} className="px-3 py-2.5" onClick={() => setSelected(item.id)}><span className="min-w-0"><SelectionRowTitle className="block truncate">{item.title}</SelectionRowTitle><SelectionRowDescription className="block truncate text-xs">{item.id}</SelectionRowDescription></span></SelectionRow>)}</SelectionList></aside>
      <div className="min-w-0 overflow-auto p-6">{active ? <div className="grid max-w-4xl gap-5">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{active.title}</h2><Badge className={`tiny-capability-effect ${active.effect}`}>{active.effect}</Badge>{active.confirmationPolicy.required ? <Badge variant="destructive">Confirmation required</Badge> : <Badge className="tiny-neutral-tag" variant="secondary">No confirmation</Badge>}</div><p className="mt-2 text-sm text-muted-foreground">{active.description}</p></div>
        <Info title="Use when"><p>{active.useWhen}</p></Info>
        <Info title="Allowed scenes"><div className="flex flex-wrap gap-2">{active.allowedScenes.map((scene) => <Badge key={scene} variant="outline">{scene}</Badge>)}</div></Info>
        {active.notes.length ? <Info title="Guardrails"><ul className="list-disc space-y-1 pl-5">{active.notes.map((note) => <li key={note}>{note}</li>)}</ul></Info> : null}
        <Info title="Input schema"><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(active.inputSchema, null, 2)}</pre></Info>
        <Info title="Output schema"><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(active.outputSchema, null, 2)}</pre></Info>
      </div> : <p className="text-sm text-muted-foreground">Loading capabilities...</p>}</div>
    </section>
  </main>;
}

function Info({ title, children }: { title: string; children: ReactElement }): ReactElement { return <section className="rounded-md border p-4 text-sm"><h3 className="mb-2 font-semibold">{title}</h3>{children}</section>; }
