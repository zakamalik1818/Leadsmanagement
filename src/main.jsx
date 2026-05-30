import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { seedData, stages, statuses, roles, solutionStreams } from "./data/crmData.js";
import "./styles.css";

const STORAGE_KEY = "hubspot-style-crm";

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => `$${Number(value || 0).toLocaleString()}`;
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));
const classNames = (...items) => items.filter(Boolean).join(" ");

function loadData() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)) || seedData);
  } catch {
    return normalizeData(seedData);
  }
}

function normalizeData(data) {
  return {
    ...data,
    leads: (data.leads || []).map((lead) => ({
      ...lead,
      pitchedStreams: Array.isArray(lead.pitchedStreams) ? lead.pitchedStreams : defaultStreamsForLead(lead).pitchedStreams,
      interestedStreams: Array.isArray(lead.interestedStreams) ? lead.interestedStreams : defaultStreamsForLead(lead).interestedStreams,
      activities: Array.isArray(lead.activities) ? lead.activities : [],
    })),
  };
}

function defaultStreamsForLead(lead) {
  if (/automation|banking|managed/i.test(lead.name || "")) {
    return { pitchedStreams: ["Managed Service", "FinOps", "WAFR"], interestedStreams: ["Managed Service", "FinOps"] };
  }
  if (/ai|ml|intake|patient/i.test(lead.name || "")) {
    return { pitchedStreams: ["Professional Service", "AI/ML", "WAFR"], interestedStreams: ["AI/ML"] };
  }
  if (/budget|fund|factory/i.test(lead.name || "")) {
    return { pitchedStreams: ["WAFR", "Funding", "Professional Service"], interestedStreams: ["Funding", "WAFR"] };
  }
  return { pitchedStreams: ["Professional Service", "FinOps"], interestedStreams: ["Professional Service"] };
}

function scoreLead(lead) {
  const source = { Referral: 20, "Website Form": 14, Webinar: 16, LinkedIn: 12, Partner: 18, "Cold Email": 8 }[lead.source] || 8;
  const status = { Won: 30, Proposal: 24, Qualified: 20, Contacted: 12, New: 6, Lost: 0 }[lead.status] || 0;
  const value = Math.min(20, Math.round(Number(lead.value || 0) / 3000));
  const streamFit = Math.min(16, (lead.interestedStreams?.length || 0) * 5 + (lead.pitchedStreams?.length || 0) * 2);
  const engagement = Math.min(14, (lead.activities?.length || 0) * 3 + (lead.emailOpens || 0) + (lead.calls || 0) * 2);
  return Math.min(100, source + status + value + streamFit + engagement);
}

function streamText(streams) {
  return (streams || []).join("; ");
}

function parseStreams(value = "") {
  return String(value)
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter((item) => solutionStreams.includes(item));
}

function parseCsvLine(line) {
  return line
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"'));
}

function App() {
  const [data, setData] = useState(loadData);
  const [page, setPage] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [leadId, setLeadId] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");

  const save = (next) => {
    setData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const patch = (updater) => save(updater(structuredClone(data)));
  const companies = useMemo(() => byId(data.companies), [data.companies]);
  const contacts = useMemo(() => byId(data.contacts), [data.contacts]);
  const users = useMemo(() => byId(data.users), [data.users]);
  const activeLead = data.leads.find((lead) => lead.id === leadId) || data.leads[0];

  const openLead = (id) => {
    setLeadId(id);
    setPage("Lead Detail");
  };

  const remove = (type, id) => {
    patch((draft) => {
      draft[type] = draft[type].filter((item) => item.id !== id);
      if (type === "leads") {
        draft.tasks = draft.tasks.filter((task) => task.leadId !== id);
        draft.notes = draft.notes.filter((note) => note.leadId !== id);
      }
      return draft;
    });
  };

  const upsert = (type, item) => {
    patch((draft) => {
      const index = draft[type].findIndex((entry) => entry.id === item.id);
      if (index >= 0) draft[type][index] = item;
      else draft[type].unshift(item);
      return draft;
    });
  };

  const exportCsv = () => {
    const rows = [
      ["name", "company", "contact", "status", "owner", "source", "pitchedStreams", "interestedStreams", "value", "lastContact", "score"],
      ...data.leads.map((lead) => [
        lead.name,
        companies[lead.companyId]?.name || "",
        contacts[lead.contactId]?.name || "",
        lead.status,
        users[lead.ownerId]?.name || "",
        lead.source,
        streamText(lead.pitchedStreams),
        streamText(lead.interestedStreams),
        lead.value,
        lead.lastContact,
        scoreLead(lead),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "leads.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importCsv = async (file) => {
    const text = await file.text();
    const [headerLine, ...lines] = text.trim().split(/\r?\n/);
    const headers = parseCsvLine(headerLine || "");
    patch((draft) => {
      lines.forEach((line) => {
        const fields = parseCsvLine(line);
        const get = (name, fallbackIndex) => {
          const index = headers.indexOf(name);
          return fields[index >= 0 ? index : fallbackIndex] || "";
        };
        const name = get("name", 0);
        const companyName = get("company", 1);
        const contactName = get("contact", 2);
        const status = get("status", 3);
        const ownerName = get("owner", 4);
        const source = get("source", 5);
        const pitchedStreams = get("pitchedStreams", -1);
        const interestedStreams = get("interestedStreams", -1);
        const value = get("value", 6);
        const lastContact = get("lastContact", 7);
        if (!name) return;
        const company = draft.companies.find((item) => item.name === companyName) || draft.companies[0];
        const contact = draft.contacts.find((item) => item.name === contactName) || draft.contacts[0];
        const owner = draft.users.find((item) => item.name === ownerName) || draft.users[1];
        draft.leads.unshift({
          id: uid("lead"),
          name,
          companyId: company.id,
          contactId: contact.id,
          status: statuses.includes(status) ? status : "New",
          ownerId: owner.id,
          source: source || "Website Form",
          pitchedStreams: parseStreams(pitchedStreams),
          interestedStreams: parseStreams(interestedStreams),
          value: Number(value || 0),
          lastContact: lastContact || today(),
          emailOpens: 0,
          calls: 0,
          activities: [{ type: "Imported", text: "Lead imported from CSV", at: today() }],
        });
      });
      return draft;
    });
    setToast("CSV imported");
    window.setTimeout(() => setToast(""), 1800);
  };

  const nav = ["Dashboard", "Leads", "Pipeline", "Companies", "Contacts", "Tasks", "Reports", "Settings"];
  const viewProps = { data, companies, contacts, users, query, setQuery, openLead, upsert, remove, setModal, patch, exportCsv, importCsv, activeLead };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div className="grid h-9 w-11 place-items-center rounded-lg bg-slate-900 text-xs font-black text-orange-400">AWS</div>
          <div>
            <div className="font-bold">AWS Leads Hub</div>
            <div className="text-xs text-slate-500">Partner sales workspace</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {nav.map((item) => (
            <button key={item} onClick={() => setPage(item)} className={classNames("nav-button", page === item && "active")}>
              {item}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-slate-200 p-4 text-sm">
          <div className="font-semibold">{data.currentUser.name}</div>
          <div className="text-slate-500">{roles[data.currentUser.role]}</div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <select className="input lg:hidden" value={page} onChange={(event) => setPage(event.target.value)}>
              {nav.map((item) => <option key={item}>{item}</option>)}
            </select>
            <div>
              <h1 className="text-xl font-bold">{page}</h1>
              <p className="text-sm text-slate-500">Track customer interest across AWS streams, pursuits, contacts, and follow-ups.</p>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <input className="input max-w-sm" placeholder="Search customers, contacts, streams..." value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
            <label className="btn-secondary cursor-pointer">
              Import
              <input className="hidden" type="file" accept=".csv" onChange={(event) => event.target.files?.[0] && importCsv(event.target.files[0])} />
            </label>
            <button className="btn-primary" onClick={() => setModal({ type: "lead" })}>New lead</button>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          {page === "Dashboard" && <Dashboard {...viewProps} />}
          {page === "Leads" && <Leads {...viewProps} />}
          {page === "Lead Detail" && <LeadDetail {...viewProps} />}
          {page === "Pipeline" && <Pipeline {...viewProps} />}
          {page === "Companies" && <Companies {...viewProps} />}
          {page === "Contacts" && <Contacts {...viewProps} />}
          {page === "Tasks" && <Tasks {...viewProps} />}
          {page === "Reports" && <Reports {...viewProps} />}
          {page === "Settings" && <Settings {...viewProps} />}
        </main>
      </div>

      {modal && <Editor modal={modal} data={data} upsert={upsert} close={() => setModal(null)} />}
      {toast && <div className="fixed bottom-4 right-4 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl">{toast}</div>}
    </div>
  );
}

function Dashboard({ data, companies, contacts, users, openLead, setModal }) {
  const open = data.leads.filter((lead) => !["Won", "Lost"].includes(lead.status));
  const won = data.leads.filter((lead) => lead.status === "Won");
  const pipeline = open.reduce((sum, lead) => sum + lead.value, 0);
  const conversion = Math.round((won.length / Math.max(1, data.leads.length)) * 100);
  const activity = data.leads.flatMap((lead) => (lead.activities || []).map((item) => ({ ...item, lead }))).slice(0, 7);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Open pursuits" value={open.length} detail={`${data.leads.length} total records`} />
        <Metric label="AWS pipeline value" value={money(pipeline)} detail="Active opportunity value" />
        <Metric label="Conversion rate" value={`${conversion}%`} detail={`${won.length} won deals`} />
        <Metric label="Follow-ups due" value={data.tasks.filter((task) => task.status !== "Done").length} detail="Open tasks and reminders" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
        <Panel title="Priority AWS pursuits" action={<button className="btn-primary" onClick={() => setModal({ type: "lead" })}>Add lead</button>}>
          <LeadTable leads={[...data.leads].sort((a, b) => scoreLead(b) - scoreLead(a)).slice(0, 6)} companies={companies} contacts={contacts} users={users} openLead={openLead} compact />
        </Panel>
        <Panel title="Recent activity">
          <div className="space-y-3">
            {activity.map((item) => (
              <div key={`${item.lead.id}-${item.at}-${item.text}`} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold">{item.type} on {item.lead.name}</div>
                <div className="text-sm text-slate-600">{item.text}</div>
                <div className="mt-1 text-xs text-slate-400">{item.at}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Leads({ data, companies, contacts, users, query, openLead, setModal, remove }) {
  const [status, setStatus] = useState("All");
  const [source, setSource] = useState("All");
  const [stream, setStream] = useState("All");
  const [sort, setSort] = useState("score");
  const q = query.toLowerCase();
  const leads = data.leads
    .filter((lead) => status === "All" || lead.status === status)
    .filter((lead) => source === "All" || lead.source === source)
    .filter((lead) => stream === "All" || lead.pitchedStreams.includes(stream) || lead.interestedStreams.includes(stream))
    .filter((lead) => [
      lead.name,
      lead.source,
      streamText(lead.pitchedStreams),
      streamText(lead.interestedStreams),
      companies[lead.companyId]?.name,
      contacts[lead.contactId]?.name,
      users[lead.ownerId]?.name,
    ].join(" ").toLowerCase().includes(q))
    .sort((a, b) => sort === "value" ? b.value - a.value : sort === "lastContact" ? b.lastContact.localeCompare(a.lastContact) : scoreLead(b) - scoreLead(a));

  return (
    <Panel title="AWS leads" action={<button className="btn-primary" onClick={() => setModal({ type: "lead" })}>Add lead</button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-44" value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
        <select className="input w-44" value={source} onChange={(event) => setSource(event.target.value)}><option>All</option>{[...new Set(data.leads.map((lead) => lead.source))].map((item) => <option key={item}>{item}</option>)}</select>
        <select className="input w-52" value={stream} onChange={(event) => setStream(event.target.value)}><option>All</option>{solutionStreams.map((item) => <option key={item}>{item}</option>)}</select>
        <select className="input w-44" value={sort} onChange={(event) => setSort(event.target.value)}><option value="score">Sort by score</option><option value="value">Sort by value</option><option value="lastContact">Sort by last contact</option></select>
      </div>
      <LeadTable leads={leads} companies={companies} contacts={contacts} users={users} openLead={openLead} edit={(lead) => setModal({ type: "lead", item: lead })} remove={(lead) => remove("leads", lead.id)} />
    </Panel>
  );
}

function LeadDetail({ activeLead: lead, data, companies, contacts, users, setModal, patch, remove }) {
  if (!lead) return <Panel title="Lead detail">No lead selected.</Panel>;
  const company = companies[lead.companyId];
  const contact = contacts[lead.contactId];
  const tasks = data.tasks.filter((task) => task.leadId === lead.id);
  const notes = data.notes.filter((note) => note.leadId === lead.id);

  const addActivity = (type, text) => patch((draft) => {
    const target = draft.leads.find((item) => item.id === lead.id);
    target.activities.unshift({ type, text, at: today() });
    target.lastContact = today();
    return draft;
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <Panel title={lead.name} action={<button className="btn-secondary" onClick={() => setModal({ type: "lead", item: lead })}>Edit</button>}>
        <div className="space-y-4">
          <div className="rounded-lg bg-orange-50 p-4">
            <div className="text-sm text-slate-600">Lead score</div>
            <div className="text-4xl font-black text-orange-700">{scoreLead(lead)}</div>
          </div>
          <Info label="Status" value={lead.status} />
          <Info label="Company" value={company?.name} />
          <Info label="Contact" value={`${contact?.name} · ${contact?.email}`} />
          <Info label="Owner" value={users[lead.ownerId]?.name} />
          <Info label="Source" value={lead.source} />
          <StreamGroup label="Pitched streams" streams={lead.pitchedStreams} />
          <StreamGroup label="Customer interest" streams={lead.interestedStreams} />
          <Info label="Value" value={money(lead.value)} />
          <Info label="Last contact" value={lead.lastContact} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => addActivity("Call", "Logged a follow-up call")}>Log call</button>
            <button className="btn-secondary" onClick={() => addActivity("Email", "Sent a sales email")}>Log email</button>
            <button className="btn-secondary" onClick={() => setModal({ type: "task", item: { leadId: lead.id } })}>Add task</button>
            <button className="btn-secondary" onClick={() => setModal({ type: "note", item: { leadId: lead.id } })}>Add note</button>
          </div>
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="Notes">
          <div className="space-y-3">{notes.map((note) => (
            <div key={note.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div>{note.text}</div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{note.createdAt}</span>
                <span className="flex gap-2">
                  <button className="icon-btn" onClick={() => setModal({ type: "note", item: note })}>Edit</button>
                  <button className="icon-btn danger" onClick={() => remove("notes", note.id)}>Delete</button>
                </span>
              </div>
            </div>
          ))}</div>
        </Panel>
        <Panel title="Tasks">
          <div className="space-y-3">{tasks.map((task) => <TaskRow key={task.id} task={task} lead={lead} patch={patch} edit={() => setModal({ type: "task", item: task })} remove={() => remove("tasks", task.id)} />)}</div>
        </Panel>
        <Panel title="Activity timeline">
          <div className="space-y-3">{lead.activities.map((item, index) => <div key={index} className="timeline-item"><b>{item.type}</b><span>{item.text}</span><small>{item.at}</small></div>)}</div>
        </Panel>
      </div>
    </div>
  );
}

function Pipeline({ data, companies, users, openLead, patch }) {
  const move = (leadId, status) => patch((draft) => {
    const lead = draft.leads.find((item) => item.id === leadId);
    lead.status = status;
    lead.activities.unshift({ type: "Stage changed", text: `Moved to ${status}`, at: today() });
    return draft;
  });

  return (
    <div className="grid min-h-[72vh] gap-4 overflow-x-auto xl:grid-cols-6">
      {stages.map((stage) => {
        const leads = data.leads.filter((lead) => lead.status === stage);
        return (
          <section key={stage} className="min-w-72 rounded-lg border border-slate-200 bg-slate-100 p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(event.dataTransfer.getData("lead"), stage)}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">{stage}</h2>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-500">{leads.length}</span>
            </div>
            <div className="space-y-3">
              {leads.map((lead) => (
                <article key={lead.id} draggable onDragStart={(event) => event.dataTransfer.setData("lead", lead.id)} onClick={() => openLead(lead.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="font-semibold">{lead.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{companies[lead.companyId]?.name}</div>
                  <div className="mt-3"><StreamChips streams={lead.interestedStreams} /></div>
                  <div className="mt-3 flex items-center justify-between text-sm"><span>{money(lead.value)}</span><span className="badge">{scoreLead(lead)}</span></div>
                  <div className="mt-2 text-xs text-slate-400">{users[lead.ownerId]?.name}</div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Companies({ data, setModal, remove }) {
  return <CrudList title="Companies" items={data.companies} fields={["name", "industry", "size", "website"]} type="company" setModal={setModal} remove={(item) => remove("companies", item.id)} />;
}

function Contacts({ data, companies, setModal, remove }) {
  const items = data.contacts.map((contact) => ({ ...contact, company: companies[contact.companyId]?.name }));
  return <CrudList title="Contacts" items={items} fields={["name", "title", "email", "phone", "company"]} type="contact" setModal={setModal} remove={(item) => remove("contacts", item.id)} />;
}

function Tasks({ data, companies, users, patch, setModal, remove }) {
  const leads = byId(data.leads);
  return (
    <Panel title="Tasks and reminders" action={<button className="btn-primary" onClick={() => setModal({ type: "task" })}>Add task</button>}>
      <div className="space-y-3">
        {data.tasks.map((task) => <TaskRow key={task.id} task={task} lead={leads[task.leadId]} company={companies[leads[task.leadId]?.companyId]} owner={users[task.ownerId]} patch={patch} edit={() => setModal({ type: "task", item: task })} remove={() => remove("tasks", task.id)} />)}
      </div>
    </Panel>
  );
}

function Reports({ data }) {
  const byStage = stages.map((stage) => ({ stage, count: data.leads.filter((lead) => lead.status === stage).length, value: data.leads.filter((lead) => lead.status === stage).reduce((sum, lead) => sum + lead.value, 0) }));
  const byStream = solutionStreams.map((stream) => ({
    stream,
    pitched: data.leads.filter((lead) => lead.pitchedStreams.includes(stream)).length,
    interested: data.leads.filter((lead) => lead.interestedStreams.includes(stream)).length,
  }));
  const max = Math.max(...byStage.map((item) => item.value), 1);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Pipeline by stage">
        <div className="space-y-4">{byStage.map((item) => <Bar key={item.stage} label={`${item.stage} · ${item.count}`} value={item.value} max={max} />)}</div>
      </Panel>
      <Panel title="Lead source performance">
        <div className="space-y-4">{[...new Set(data.leads.map((lead) => lead.source))].map((source) => {
          const leads = data.leads.filter((lead) => lead.source === source);
          return <Bar key={source} label={`${source} · ${leads.length}`} value={Math.round(leads.reduce((sum, lead) => sum + scoreLead(lead), 0) / leads.length)} max={100} suffix=" avg score" />;
        })}</div>
      </Panel>
      <Panel title="AWS stream coverage">
        <div className="space-y-4">{byStream.map((item) => (
          <div key={item.stream} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">{item.stream}</span><span className="text-slate-500">{item.interested} interested / {item.pitched} pitched</span></div>
            <div className="grid grid-cols-2 gap-2">
              <Bar label="Pitched" value={item.pitched} max={Math.max(1, data.leads.length)} suffix="" />
              <Bar label="Interested" value={item.interested} max={Math.max(1, data.leads.length)} suffix="" />
            </div>
          </div>
        ))}</div>
      </Panel>
    </div>
  );
}

function Settings({ data }) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Roles">
        {Object.entries(roles).map(([key, value]) => <Info key={key} label={value} value={key} />)}
      </Panel>
      <Panel title="Pipeline stages">
        <div className="flex flex-wrap gap-2">{stages.map((stage) => <span key={stage} className="badge">{stage}</span>)}</div>
      </Panel>
      <Panel title="AWS streams">
        <StreamChips streams={solutionStreams} />
      </Panel>
      <Panel title="Workspace">
        <Info label="Storage" value="Browser localStorage" />
        <Info label="Current user" value={`${data.currentUser.name} · ${roles[data.currentUser.role]}`} />
        <Info label="API ready" value="Data actions are isolated for later backend wiring" />
      </Panel>
    </div>
  );
}

function Editor({ modal, data, upsert, close }) {
  const typeMap = {
    lead: "leads",
    company: "companies",
    contact: "contacts",
    task: "tasks",
    note: "notes",
  };
  const isNew = !modal.item?.id;
  const [form, setForm] = useState(() => ({
    status: "New",
    source: "Website Form",
    pitchedStreams: [],
    interestedStreams: [],
    ownerId: data.users[1]?.id,
    companyId: data.companies[0]?.id,
    contactId: data.contacts[0]?.id,
    leadId: data.leads[0]?.id,
    due: today(),
    priority: "Medium",
    value: 10000,
    ...modal.item,
  }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    if (modal.type === "note") {
      upsert("notes", { id: form.id || uid("note"), leadId: form.leadId, text: form.text, createdAt: form.createdAt || today() });
    } else if (modal.type === "lead") {
      upsert("leads", { activities: [], emailOpens: 0, calls: 0, lastContact: today(), ...form, pitchedStreams: form.pitchedStreams || [], interestedStreams: form.interestedStreams || [], value: Number(form.value || 0), id: form.id || uid("lead") });
    } else if (modal.type === "task") {
      upsert("tasks", { status: "Open", ...form, id: form.id || uid("task") });
    } else {
      upsert(typeMap[modal.type], { ...form, id: form.id || uid(modal.type) });
    }
    close();
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-4">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isNew ? "Add" : "Edit"} {modal.type}</h2>
          <button type="button" className="btn-secondary" onClick={close}>Close</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {modal.type === "lead" && <>
            <Field label="Pursuit name" value={form.name || ""} onChange={(v) => set("name", v)} required />
            <Field label="Value" type="number" value={form.value || ""} onChange={(v) => set("value", v)} />
            <Select label="Company" value={form.companyId} onChange={(v) => set("companyId", v)} options={data.companies.map((item) => [item.id, item.name])} />
            <Select label="Contact" value={form.contactId} onChange={(v) => set("contactId", v)} options={data.contacts.map((item) => [item.id, item.name])} />
            <Select label="Status" value={form.status} onChange={(v) => set("status", v)} options={statuses.map((item) => [item, item])} />
            <Select label="Owner" value={form.ownerId} onChange={(v) => set("ownerId", v)} options={data.users.map((item) => [item.id, item.name])} />
            <Field label="Source" value={form.source || ""} onChange={(v) => set("source", v)} />
            <MultiSelect label="Streams pitched" values={form.pitchedStreams || []} onChange={(values) => set("pitchedStreams", values)} options={solutionStreams} />
            <MultiSelect label="Customer interest" values={form.interestedStreams || []} onChange={(values) => set("interestedStreams", values)} options={solutionStreams} />
          </>}
          {modal.type === "company" && <>
            <Field label="Name" value={form.name || ""} onChange={(v) => set("name", v)} required />
            <Field label="Industry" value={form.industry || ""} onChange={(v) => set("industry", v)} />
            <Field label="Size" value={form.size || ""} onChange={(v) => set("size", v)} />
            <Field label="Website" value={form.website || ""} onChange={(v) => set("website", v)} />
          </>}
          {modal.type === "contact" && <>
            <Field label="Name" value={form.name || ""} onChange={(v) => set("name", v)} required />
            <Field label="Title" value={form.title || ""} onChange={(v) => set("title", v)} />
            <Field label="Email" value={form.email || ""} onChange={(v) => set("email", v)} />
            <Field label="Phone" value={form.phone || ""} onChange={(v) => set("phone", v)} />
            <Select label="Company" value={form.companyId} onChange={(v) => set("companyId", v)} options={data.companies.map((item) => [item.id, item.name])} />
          </>}
          {modal.type === "task" && <>
            <Field label="Task" value={form.title || ""} onChange={(v) => set("title", v)} required />
            <Select label="Lead" value={form.leadId} onChange={(v) => set("leadId", v)} options={data.leads.map((item) => [item.id, item.name])} />
            <Select label="Owner" value={form.ownerId} onChange={(v) => set("ownerId", v)} options={data.users.map((item) => [item.id, item.name])} />
            <Field label="Due date" type="date" value={form.due || today()} onChange={(v) => set("due", v)} />
            <Select label="Priority" value={form.priority} onChange={(v) => set("priority", v)} options={["Low", "Medium", "High"].map((item) => [item, item])} />
          </>}
          {modal.type === "note" && <>
            <Select label="Lead" value={form.leadId} onChange={(v) => set("leadId", v)} options={data.leads.map((item) => [item.id, item.name])} />
            <label className="md:col-span-2"><span className="label">Note</span><textarea className="input min-h-28" value={form.text || ""} onChange={(event) => set("text", event.target.value)} required /></label>
          </>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button className="btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function LeadTable({ leads, companies, contacts, users, openLead, edit, remove, compact }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead><tr>{["Customer pursuit", "Status", "Owner", "Pitched", "Interested", "Value", "Last contact", "Score", ""].map((item) => <th key={item}>{item}</th>)}</tr></thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td><button className="link" onClick={() => openLead(lead.id)}>{lead.name}</button><small>{companies[lead.companyId]?.name} · {contacts[lead.contactId]?.name}</small></td>
              <td><span className={classNames("badge", lead.status.toLowerCase())}>{lead.status}</span></td>
              <td>{users[lead.ownerId]?.name}</td>
              <td><StreamChips streams={lead.pitchedStreams} /></td>
              <td><StreamChips streams={lead.interestedStreams} /></td>
              <td>{money(lead.value)}</td>
              <td>{lead.lastContact}</td>
              <td><span className="badge">{scoreLead(lead)}</span></td>
              <td>{!compact && <div className="flex gap-2"><button className="icon-btn" onClick={() => edit(lead)}>Edit</button><button className="icon-btn danger" onClick={() => remove(lead)}>Delete</button></div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrudList({ title, items, fields, type, setModal, remove }) {
  return (
    <Panel title={title} action={<button className="btn-primary" onClick={() => setModal({ type })}>Add {type}</button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}<th /></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>{fields.map((field) => <td key={field}>{item[field]}</td>)}<td><div className="flex gap-2"><button className="icon-btn" onClick={() => setModal({ type, item })}>Edit</button><button className="icon-btn danger" onClick={() => remove(item)}>Delete</button></div></td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function TaskRow({ task, lead, company, owner, patch, edit, remove }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <div className="font-semibold">{task.title}</div>
        <div className="text-sm text-slate-500">{lead?.name}{company ? ` · ${company.name}` : ""}{owner ? ` · ${owner.name}` : ""}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className={classNames("badge", task.priority?.toLowerCase())}>{task.priority}</span>
        <span className="text-sm text-slate-500">{task.due}</span>
        <button className="icon-btn" onClick={() => patch((draft) => {
          const target = draft.tasks.find((item) => item.id === task.id);
          target.status = target.status === "Done" ? "Open" : "Done";
          return draft;
        })}>{task.status === "Done" ? "Reopen" : "Done"}</button>
        {edit && <button className="icon-btn" onClick={edit}>Edit</button>}
        {remove && <button className="icon-btn danger" onClick={remove}>Delete</button>}
      </div>
    </div>
  );
}

function Metric({ label, value, detail }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-500">{label}</div><div className="mt-2 text-3xl font-black">{value}</div><div className="mt-1 text-sm text-slate-500">{detail}</div></div>;
}

function Panel({ title, action, children }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-bold">{title}</h2>{action}</div>{children}</section>;
}

function Field({ label, value, onChange, type = "text", required }) {
  return <label><span className="label">{label}</span><input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}

function Select({ label, value, onChange, options }) {
  return <label><span className="label">{label}</span><select className="input" value={value || ""} onChange={(event) => onChange(event.target.value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function MultiSelect({ label, values, onChange, options }) {
  const toggle = (option) => {
    onChange(values.includes(option) ? values.filter((item) => item !== option) : [...values, option]);
  };
  return (
    <fieldset className="md:col-span-2">
      <legend className="label">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <label key={option} className={classNames("stream-option", values.includes(option) && "selected")}>
            <input type="checkbox" checked={values.includes(option)} onChange={() => toggle(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function StreamChips({ streams }) {
  if (!streams?.length) return <span className="text-xs font-semibold text-slate-400">None</span>;
  return <div className="flex flex-wrap gap-1.5">{streams.map((stream) => <span key={stream} className="stream-chip">{stream}</span>)}</div>;
}

function StreamGroup({ label, streams }) {
  return <div className="mb-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2"><StreamChips streams={streams} /></div></div>;
}

function Info({ label, value }) {
  return <div className="mb-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="text-sm font-semibold text-slate-700">{value || "Not set"}</div></div>;
}

function Bar({ label, value, max, suffix = null }) {
  const display = suffix === null ? money(value) : `${value}${suffix}`;
  return <div><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{label}</span><span className="text-slate-500">{display}</span></div><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-600" style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }} /></div></div>;
}

createRoot(document.getElementById("app")).render(<App />);
