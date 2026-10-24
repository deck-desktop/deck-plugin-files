// The explorer's left side: pinned folders, this PC's drives with their free space, and the
// servers in ~/.ssh/config. Drives are read when the sidebar appears and on Refresh, never on a
// timer: asking a drive for its space is a one-off.
import { useEffect, useState } from "react";
import { HardDrive, Plus, RefreshCw, Server, Star, Usb } from "lucide-react";
import { fsDrives, remoteHome, sshHosts, type Drive } from "../shim/bridge.js";
import { ContextMenu, IconButton, type MenuEntry } from "../shim/ui.js";
import { freeLabel, samePath } from "./logic";
import { update, type Pin } from "./store";
import { DROP } from "./drag";

const row = "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors";
const head = "px-2 pb-1 text-[11px] font-medium text-text-muted";

export function Sidebar({ cwd, pins, onOpen, fail }: {
  cwd: string; pins: Pin[]; onOpen: (path: string) => void; fail: (what: string, e: unknown) => void;
}) {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const loadDrives = () => void fsDrives().then(setDrives, (e: unknown) => fail("Reading the drives failed", e));
  useEffect(() => {
    loadDrives();
    void sshHosts().then(setHosts, () => setHosts([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (p: string) => samePath(p, cwd);
  const openHost = (host: string) => void remoteHome(host, false).then((home: string) => onOpen(home), (e: unknown) => fail(`Connecting to ${host} failed`, e));
  const pinMenu = (e: React.MouseEvent, p: Pin) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: "Open", onClick: () => onOpen(p.path) },
      { label: "Unpin", onClick: () => update((s) => ({ pins: s.pins.filter((x) => x.path !== p.path) })) },
    ] });
  };

  return (
    <nav aria-label="Places" className="scroll-thin flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-subtle bg-panel px-2 py-3">
      <div className="flex flex-col">
        <span className={head}>Pinned</span>
        {pins.map((p) => (
          <button key={p.path} onClick={() => onOpen(p.path)} onContextMenu={(e) => pinMenu(e, p)} title={p.path} {...{ [DROP]: p.path }}
            className={row + (at(p.path) ? " bg-white/[0.07] text-text-primary" : " text-text-secondary hover:bg-white/5 hover:text-text-primary")}>
            <Star size={13} className="shrink-0 text-[var(--accent)]" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {pins.length === 0 && <span className="px-2 text-[11.5px] text-text-muted">Right-click a folder and Pin it here.</span>}
      </div>

      <div className="flex flex-col">
        <div className="flex items-center pr-1">
          <span className={head + " flex-1"}>This PC</span>
          <IconButton size="row" title="Read the drives again" onClick={loadDrives}><RefreshCw size={11} /></IconButton>
        </div>
        {drives.map((d) => {
          const used = d.total ? 1 - d.free / d.total : 0;
          const name = d.label ? `${d.label} (${d.path.slice(0, 2)})` : d.kind === "network" ? `Network (${d.path.slice(0, 2)})` : `${d.path.slice(0, 2)}`;
          return (
            <button key={d.path} onClick={() => onOpen(d.path)} title={d.path} {...{ [DROP]: d.path }}
              className={"flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors " + (at(d.path) ? "bg-white/[0.07] text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary")}>
              <span className="flex w-full items-center gap-2">
                {d.kind === "removable" ? <Usb size={13} className="shrink-0" /> : <HardDrive size={13} className="shrink-0" />}
                <span className="truncate">{name}</span>
                {d.total > 0 && <span className="ml-auto shrink-0 text-[11px] text-text-muted">{freeLabel(d.free)}</span>}
              </span>
              {d.total > 0 && (
                <span className="h-1 w-full overflow-hidden rounded-full bg-elev">
                  <span className="block h-1 rounded-full" style={{ width: `${Math.round(used * 100)}%`, background: used > 0.9 ? "rgb(var(--tone-red-400))" : used > 0.75 ? "rgb(var(--tone-amber-400))" : "var(--accent)" }} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col">
        <span className={head}>Servers</span>
        {hosts.map((h) => (
          <button key={h} onClick={() => openHost(h)} title={`${h}, from ~/.ssh/config`}
            className={row + (cwd.startsWith(`${h}:`) ? " bg-white/[0.07] text-text-primary" : " text-text-secondary hover:bg-white/5 hover:text-text-primary")}>
            <Server size={13} className="shrink-0" />
            <span className="truncate">{h}</span>
          </button>
        ))}
        {hosts.length === 0 && (
          <span className="flex items-center gap-1.5 px-2 text-[11.5px] text-text-muted"><Plus size={11} />Hosts in ~/.ssh/config show here.</span>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </nav>
  );
}
