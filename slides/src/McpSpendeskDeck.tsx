import React, { useState } from "react";

type SlideId =
  | "intro"
  | "phase1"
  | "phase2"
  | "phase3"
  | "phase4"
  | "phase5"
  | "phase6"
  | "phase7"
  | "conclusion";

type Lang = "fr" | "en";

const SLIDES: SlideId[] = [
  "intro",
  "phase1",
  "phase2",
  "phase3",
  "phase4",
  "phase5",
  "phase6",
  "phase7",
  "conclusion",
];

const spendeskColors = {
  background: "#020617",
  panelBorder: "#1e293b",
  accent: "#4f46e5",
  accentSoft: "rgba(79,70,229,0.12)",
  textPrimary: "#e5e7eb",
  textSecondary: "#9ca3af",
  chipBg: "#0f172a",
  chipBorder: "#1f2933",
};

const baseLayout: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  background: `radial-gradient(circle at top left, rgba(79,70,229,0.28), transparent 55%), ${spendeskColors.background}`,
  color: spendeskColors.textPrimary,
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
};

const containerStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "32px 24px 48px",
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const slideCard: React.CSSProperties = {
  borderRadius: 24,
  border: `1px solid ${spendeskColors.panelBorder}`,
  background:
    "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(15,23,42,0.96))",
  boxShadow:
    "0 24px 60px rgba(15,23,42,0.9), 0 0 0 1px rgba(15,23,42,0.8)",
  padding: 32,
};

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 10px",
  borderRadius: 999,
  border: `1px solid rgba(148,163,184,0.4)`,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.08,
  color: spendeskColors.textSecondary,
};

const h1Style: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 600,
  letterSpacing: -0.02,
  margin: "8px 0 4px",
};

const h2Style: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  letterSpacing: -0.01,
  margin: "0 0 8px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: spendeskColors.textSecondary,
  maxWidth: 640,
};

const bullets: React.CSSProperties = {
  marginTop: 16,
  paddingLeft: 18,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 14,
};

const bulletItem: React.CSSProperties = {
  color: spendeskColors.textPrimary,
};

const navBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 16,
};

const navButtons: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const navButton: React.CSSProperties = {
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 13,
  border: `1px solid ${spendeskColors.panelBorder}`,
  backgroundColor: "#020617",
  color: spendeskColors.textPrimary,
  cursor: "pointer",
};

const navButtonPrimary: React.CSSProperties = {
  ...navButton,
  border: "none",
  background:
    "linear-gradient(135deg, #6366f1, #4f46e5)",
};

const slideIndexText: React.CSSProperties = {
  fontSize: 12,
  color: spendeskColors.textSecondary,
};

const chipRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
};

const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  border: `1px solid ${spendeskColors.chipBorder}`,
  backgroundColor: spendeskColors.chipBg,
  fontSize: 11,
  color: spendeskColors.textSecondary,
};

const codeBlock: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 12,
  border: `1px solid rgba(15,23,42,0.9)`,
  backgroundColor: "#020617",
  fontFamily: "Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  color: spendeskColors.textSecondary,
  whiteSpace: "pre-wrap",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.08,
  color: spendeskColors.textSecondary,
  marginTop: 20,
  marginBottom: 6,
};

const ToggleButton: React.FC<{
  active: boolean;
  label: string;
  onClick: () => void;
}> = ({ active, label, onClick }) => (
  <button
    onClick={onClick}
    type="button"
    style={{
      borderRadius: 999,
      padding: "4px 10px",
      fontSize: 11,
      border: active
        ? `1px solid ${spendeskColors.accent}`
        : `1px solid ${spendeskColors.chipBorder}`,
      backgroundColor: active
        ? spendeskColors.accentSoft
        : spendeskColors.chipBg,
      color: active ? spendeskColors.textPrimary : spendeskColors.textSecondary,
      cursor: "pointer",
    }}
  >
    {label}
  </button>
);

const AnalyzeSpendExample: React.FC<{ lang: Lang }> = ({ lang }) => {
  const [scenario, setScenario] = useState<"suppliers" | "costCenter">(
    "suppliers",
  );

  const prompt =
    scenario === "suppliers"
      ? lang === "fr"
        ? `Je suis CFO. Donne-moi le top 10 des fournisseurs par spend sur Q1 2026, en EUR, avec leur montant total et le nombre de factures.`
        : `I am a CFO. Give me the top 10 suppliers by spend for Q1 2026 in EUR, with total amount and invoice count.`
      : lang === "fr"
        ? `Je suis contrôleur de gestion. Donne-moi la répartition des dépenses par centre de coût pour Q1 2026, triée par montant décroissant.`
        : `I am a FP&A manager. Show the spend by cost center for Q1 2026, sorted by amount (descending).`;

  const toolCall =
    scenario === "suppliers"
      ? `spendesk_analyze_spend(
  from = "2026-01-01",
  to   = "2026-03-31",
  groupBy = ["supplier", "month"],
  limit   = 10
)`
      : `spendesk_analyze_spend(
  from    = "2026-01-01",
  to      = "2026-03-31",
  groupBy = "costCenter"
)`;

  const simulatedResult =
    scenario === "suppliers"
      ? lang === "fr"
        ? `Résultat (extrait)
-------------------
1. Aircall — 125 430 € (42 factures)
2. AWS — 98 210 € (37 factures)
3. Datadog — 54 980 € (19 factures)

Interprétation
--------------
- Forte concentration sur 3 fournisseurs SaaS.
- Opportunité de renégocier les contrats ou packager les offres.`
        : `Sample result (excerpt)
----------------------
1. Aircall — €125,430 (42 invoices)
2. AWS — €98,210 (37 invoices)
3. Datadog — €54,980 (19 invoices)

Interpretation
--------------
- Spend is concentrated on 3 key SaaS vendors.
- Potential to renegotiate contracts or bundle licences.`
      : lang === "fr"
        ? `Résultat (extrait)
-------------------
- Marketing — 184 000 € (Q1 2026)
- Sales — 132 000 €
- Operations — 96 500 €

Interprétation
--------------
- Forte saisonnalité sur Marketing au Q1.
- Utile pour préparer le budget Q2 et les accruals.`
        : `Sample result (excerpt)
----------------------
- Marketing — €184,000 (Q1 2026)
- Sales — €132,000
- Operations — €96,500

Interpretation
--------------
- Strong Q1 seasonality on Marketing.
- Useful to prepare Q2 budget and accruals.`;

  return (
    <div
      style={{
        marginTop: 20,
        borderRadius: 16,
        border: `1px solid ${spendeskColors.panelBorder}`,
        backgroundColor: "#020617",
        padding: 16,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: spendeskColors.textSecondary }}>
          {lang === "fr" ? "Prompt utilisateur" : "User prompt"}
        </div>
        <p
          style={{
            marginTop: 4,
            fontSize: 13,
            color: spendeskColors.textPrimary,
          }}
        >
          {prompt}
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <ToggleButton
            active={scenario === "suppliers"}
            label={lang === "fr" ? "Top fournisseurs" : "Top suppliers"}
            onClick={() => setScenario("suppliers")}
          />
          <ToggleButton
            active={scenario === "costCenter"}
            label={lang === "fr" ? "Par centre de coût" : "By cost center"}
            onClick={() => setScenario("costCenter")}
          />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: spendeskColors.textSecondary }}>
          Appel tool MCP
        </div>
        <pre style={codeBlock}>{toolCall}</pre>
        <div
          style={{
            fontSize: 12,
            color: spendeskColors.textSecondary,
            marginTop: 10,
            marginBottom: 2,
          }}
        >
          {lang === "fr"
            ? "Réponse (simulée, côté Claude)"
            : "Answer (simulated, from Claude)"}
        </div>
        <pre style={codeBlock}>{simulatedResult}</pre>
      </div>
    </div>
  );
};

const SqliteWorkflowExample: React.FC<{ lang: Lang }> = ({ lang }) => {
  const [step, setStep] = useState<0 | 1 | 2>(0);

  const steps = [
    {
      title: lang === "fr" ? "1. Charger les payables" : "1. Load payables",
      code: `spendesk_load_sqlite_data(
  dataset   = "payables",
  from_date = "2026-01-01",
  to_date   = "2026-03-31"
)`,
      desc:
        lang === "fr"
          ? "Le LLM charge toutes les factures/notes de frais de Q1 2026 dans une table SQLite in-memory."
          : "The LLM loads all invoices/expense claims for Q1 2026 into an in-memory SQLite table.",
    },
    {
      title: lang === "fr" ? "2. Inspecter les tables" : "2. Inspect tables",
      code: `spendesk_list_loaded_tables()`,
      desc:
        lang === "fr"
          ? "Il vérifie quelles tables sont disponibles (payables, suppliers, …) et leur schéma."
          : "It checks which tables are available (payables, suppliers, …) and their schema.",
    },
    {
      title: lang === "fr" ? "3. Lancer la requête SQL" : "3. Run the SQL query",
      code: `spendesk_execute_sql_query(sql = "
  SELECT supplier_name,
         strftime('%Y-%m', payable_date) AS month,
         SUM(amount_eur) AS total_eur
  FROM payables
  GROUP BY supplier_name, month
  ORDER BY total_eur DESC
  LIMIT 20;
")`,
      desc:
        lang === "fr"
          ? "Il obtient une matrice fournisseur × mois pour construire un tableau ou un graphique pour le CFO."
          : "It gets a supplier × month matrix to build a table or chart for the CFO.",
    },
  ];

  return (
    <div
      style={{
        marginTop: 20,
        borderRadius: 16,
        border: `1px solid ${spendeskColors.panelBorder}`,
        backgroundColor: "#020617",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {steps.map((s, idx) => (
          <ToggleButton
            key={s.title}
            active={step === idx}
            label={s.title}
            onClick={() => setStep(idx as 0 | 1 | 2)}
          />
        ))}
      </div>
      <p
        style={{
          fontSize: 13,
          color: spendeskColors.textSecondary,
          marginBottom: 8,
        }}
      >
        {steps[step].desc}
      </p>
      <pre style={codeBlock}>{steps[step].code}</pre>
    </div>
  );
};

const IntroSlide: React.FC<{ lang: Lang }> = ({ lang }) => (
  <div style={slideCard}>
    <span style={pill}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background:
            "radial-gradient(circle, #a855f7, #4f46e5)",
        }}
      />
      MCP Spendesk
    </span>
    <h1 style={h1Style}>
      {lang === "fr"
        ? "Rendre Spendesk « MCP-native »"
        : "Making Spendesk MCP-native"}
    </h1>
    <p style={subtitleStyle}>
      {lang === "fr"
        ? "Comment nous avons itéré sur le serveur MCP Spendesk pour exposer l’API publique, la fiabiliser, la monitorer et en faire un moteur d’analytics pilotable par les LLM."
        : "How we iterated on the Spendesk MCP server to expose the public API, harden it, monitor it, and turn it into an analytics engine driven by LLMs."}
    </p>
    <ul style={bullets}>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Objectif" : "Goal"}</strong>
        {lang === "fr"
          ? " : rendre les données Spendesk actionnables pour les LLM et les intégrations."
          : " : make Spendesk data actionable for LLMs and integrations."}
      </li>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Angle" : "Angle"}</strong>
        {lang === "fr"
          ? " : une histoire par phases, centrée sur les problèmes adressés et l’impact produit."
          : " : a phased story focused on problems solved and product impact."}
      </li>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Résultat" : "Outcome"}</strong>
        {lang === "fr"
          ? " : un MCP robuste, observable, pensé pour l’ergonomie des LLM et les besoins Finance/Compta."
          : " : a robust, observable MCP designed for LLM ergonomics and Finance/Accounting needs."}
      </li>
    </ul>
    <div style={chipRow}>
      <span style={chip}>Claude / Dust / Cursor</span>
      <span style={chip}>Spend Management</span>
      <span style={chip}>Finance &amp; Compta</span>
    </div>
  </div>
);

const PhaseSlide: React.FC<{
  phase: string;
  title: string;
  context: string;
  changes: string[];
  impact: string[];
  children?: React.ReactNode;
}> = ({ phase, title, context, changes, impact, children }) => (
  <div style={slideCard}>
    <span style={pill}>{phase}</span>
    <h2 style={h2Style}>{title}</h2>
    <p style={subtitleStyle}>{context}</p>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
        gap: 24,
        marginTop: 18,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.08,
            color: spendeskColors.textSecondary,
            marginBottom: 6,
          }}
        >
          Changements clés
        </div>
        <ul style={bullets}>
          {changes.map((c) => (
            <li key={c} style={bulletItem}>
              {c}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.08,
            color: spendeskColors.textSecondary,
            marginBottom: 6,
          }}
        >
          Impact produit
        </div>
        <ul style={bullets}>
          {impact.map((i) => (
            <li key={i} style={bulletItem}>
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
    {children}
  </div>
);

const ConclusionSlide: React.FC<{ lang: Lang }> = ({ lang }) => (
  <div style={slideCard}>
    <span style={pill}>{lang === "fr" ? "Phase finale" : "Final phase"}</span>
    <h2 style={h2Style}>
      {lang === "fr"
        ? "Où on en est & prochaines étapes"
        : "Where we are & next steps"}
    </h2>
    <p style={subtitleStyle}>
      {lang === "fr"
        ? "Le MCP Spendesk est passé d’un simple pont vers l’API à un véritable moteur d’insights pour la finance et la compta, tout en restant aligné avec le produit."
        : "The Spendesk MCP has evolved from a simple API bridge to a real insights engine for Finance and Accounting, while staying aligned with the core product."}
    </p>
    <ul style={bullets}>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Aujourd’hui" : "Today"}</strong>
        {lang === "fr"
          ? " : MCP robuste, instrumenté, avec des tools pensés pour les LLM, plus un moteur SQLite éphémère pour l’analytics avancée."
          : " : a robust, instrumented MCP with tools designed for LLMs, plus an ephemeral SQLite analytics engine."}
      </li>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Ce qui marche bien" : "What works well"}</strong>
        {lang === "fr"
          ? " : analyse de spend, pipeline comptable, monitoring d’usage, requêtes SQL complexes sur les données Spendesk."
          : " : spend analysis, bookkeeping pipeline, usage monitoring, complex SQL queries on Spendesk data."}
      </li>
      <li style={bulletItem}>
        <strong>{lang === "fr" ? "Prochaines pistes" : "Next steps"}</strong>
        {lang === "fr"
          ? " : multi-groupBy natif dans "
          : " : native multi-groupBy in "}
        <code>spendesk_analyze_spend</code>
        {lang === "fr"
          ? ", packs d’analyses prêts à l’emploi, intégration plus profonde dans l’UI Spendesk (insights « en un clic »)."
          : ", packaged analysis templates, and deeper integration into the Spendesk UI (one‑click insights)."}
      </li>
    </ul>
  </div>
);

export const McpSpendeskDeck: React.FC = () => {
  const [current, setCurrent] = useState<SlideId>("intro");
  const [lang, setLang] = useState<Lang>("fr");
  const currentIndex = SLIDES.indexOf(current);

  const goNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      setCurrent(SLIDES[currentIndex + 1]);
    }
  };
  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrent(SLIDES[currentIndex - 1]);
    }
  };

  return (
    <div style={baseLayout}>
      <header
        style={{
          borderBottom: `1px solid rgba(148,163,184,0.25)`,
          backdropFilter: "blur(18px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            ...containerStyle,
            paddingTop: 14,
            paddingBottom: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 8,
                background:
                  "radial-gradient(circle at 30% 20%, #a855f7, #4f46e5)",
              }}
            />
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: spendeskColors.textPrimary,
              }}
            >
              {lang === "fr"
                ? "Spendesk MCP — Storyboard Produit"
                : "Spendesk MCP — Product Storyboard"}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              color: spendeskColors.textSecondary,
            }}
          >
            <div>
              <button
                type="button"
                onClick={() => setLang("fr")}
                style={{
                  borderRadius: 999,
                  padding: "2px 8px",
                  marginRight: 4,
                  fontSize: 11,
                  border:
                    lang === "fr"
                      ? `1px solid ${spendeskColors.accent}`
                      : `1px solid ${spendeskColors.panelBorder}`,
                  backgroundColor:
                    lang === "fr" ? spendeskColors.accentSoft : "#020617",
                  color: spendeskColors.textPrimary,
                  cursor: "pointer",
                }}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                style={{
                  borderRadius: 999,
                  padding: "2px 8px",
                  fontSize: 11,
                  border:
                    lang === "en"
                      ? `1px solid ${spendeskColors.accent}`
                      : `1px solid ${spendeskColors.panelBorder}`,
                  backgroundColor:
                    lang === "en" ? spendeskColors.accentSoft : "#020617",
                  color: spendeskColors.textPrimary,
                  cursor: "pointer",
                }}
              >
                EN
              </button>
            </div>
            <div>
              {lang === "fr" ? "Slide" : "Slide"} {currentIndex + 1} /{" "}
              {SLIDES.length}
            </div>
          </div>
        </div>
      </header>

      <main style={containerStyle}>
        {current === "intro" && <IntroSlide lang={lang} />}

        {current === "phase1" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 1" : "Phase 1"}
            title={
              lang === "fr"
                ? "MVP & exposition de l’API Spendesk"
                : "MVP & exposing the Spendesk API"
            }
            context={
              lang === "fr"
                ? "Exposer rapidement l’API publique Spendesk aux LLM pour tester des use cases finance/compta sans modifier le produit core."
                : "Quickly expose the Spendesk public API to LLMs to test finance/accounting use cases without changing the core product."
            }
            changes={
              lang === "fr"
                ? [
                    "Serveur MCP TypeScript (stdio + HTTP streamable).",
                    "Mapping des endpoints clés (payables, settlements, suppliers, users, purchase orders) en tools MCP.",
                    "Première doc Mintlify pour guider les clients MCP.",
                  ]
                : [
                    "TypeScript MCP server (stdio + streamable HTTP).",
                    "Mapping of key endpoints (payables, settlements, suppliers, users, purchase orders) to MCP tools.",
                    "First Mintlify doc to guide MCP clients.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Prototypage rapide de questions finance/compta en langage naturel.",
                    "Validation de la valeur d’un « Spendesk MCP » avant d’industrialiser.",
                    "Point d’entrée unique pour les LLM sur les données Spendesk.",
                  ]
                : [
                    "Fast prototyping of finance/accounting questions in natural language.",
                    "Validation of the value of a “Spendesk MCP” before industrialising.",
                    "Single entrypoint for LLMs on Spendesk data.",
                  ]
            }
          >
            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>
                {lang === "fr"
                  ? "Dig Deeper — Architecture MCP"
                  : "Dig Deeper — MCP architecture"}
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Nous avons choisi un serveur MCP Node/TypeScript unique qui expose l’API publique Spendesk, plutôt qu’un connecteur direct par client ou un proxy générique."
                  : "We chose a single Node/TypeScript MCP server that exposes the Spendesk public API, instead of per‑client connectors or a generic proxy."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `Claude / Dust / Cursor
        │
        ▼
Serveur MCP Spendesk (Node)
        │
        ▼
API publique Spendesk`
                  : `Claude / Dust / Cursor
        │
        ▼
Spendesk MCP server (Node)
        │
        ▼
Spendesk public API`}
              </pre>
              <ul style={bullets}>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Alternative : un connecteur par client (Dust, Claude…) mais difficile à maintenir."
                    : "Alternative: build one connector per client (Dust, Claude, …) but hard to maintain."}
                </li>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Alternative : un simple proxy HTTP, mais sans typage ni outils dédiés."
                    : "Alternative: a simple HTTP proxy with no typing or purpose‑built tools."}
                </li>
              </ul>
            </div>
          </PhaseSlide>
        )}

        {current === "phase2" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 2" : "Phase 2"}
            title={
              lang === "fr"
                ? "Documentation, /doc & nettoyage des tools"
                : "Documentation, /doc & tool clean‑up"
            }
            context={
              lang === "fr"
                ? "Rendre le MCP découvrable et compréhensible (humains & LLM) en maîtrisant la surface fonctionnelle exposée."
                : "Make the MCP discoverable and understandable (humans & LLMs) by controlling the exposed functional surface."
            }
            changes={
              lang === "fr"
                ? [
                    "Route /doc vers la doc Mintlify configurable via DOCS_URL.",
                    "Fichier config/tools.config.json pour désactiver les tools expérimentaux.",
                    "Script de synchro qui masque les tools désactivés dans la doc.",
                  ]
                : [
                    "/doc route to Mintlify doc, configurable via DOCS_URL.",
                    "config/tools.config.json to disable experimental tools.",
                    "Sync script that hides disabled tools from the doc.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Surface fonctionnelle claire côté produit et côté intégrateurs.",
                    "Moins de confusion sur les tools « beta » ou non supportés.",
                    "Onboarding des équipes internes facilité.",
                  ]
                : [
                    "Clear functional surface for product and integrators.",
                    "Less confusion around “beta” or unsupported tools.",
                    "Easier onboarding for internal teams.",
                  ]
            }
          />
        )}

        {current === "phase3" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 3" : "Phase 3"}
            title={
              lang === "fr"
                ? "Robustesse métier (snapshots & retries)"
                : "Business robustness (snapshots & retries)"
            }
            context={
              lang === "fr"
                ? "Stabiliser les endpoints d’analyse de spend basés sur les snapshots de payables (409, timeouts, grandes périodes)."
                : "Stabilise spend analysis endpoints based on payables snapshots (409, timeouts, long periods)."
            }
            changes={
              lang === "fr"
                ? [
                    "Fonctions safeEndDate et splitDateRange pour respecter les contraintes API.",
                    "createSnapshotWithRetry : gestion intelligente des 409.",
                    "fetchAllPayables : orchestration complète (snapshots + polling + pagination parallèle).",
                  ]
                : [
                    "safeEndDate and splitDateRange to respect API constraints.",
                    "createSnapshotWithRetry: smart handling of 409s.",
                    "fetchAllPayables: full orchestration (snapshots + polling + parallel pagination).",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Analyses sur trimestre / année qui ne plantent plus aléatoirement.",
                    "Moins d’erreurs techniques remontées à l’utilisateur final.",
                    "Confiance accrue des équipes Finance/Compta dans les réponses générées.",
                  ]
                : [
                    "Quarter / year analyses that no longer fail randomly.",
                    "Fewer technical errors exposed to end users.",
                    "Increased confidence from Finance/Accounting in generated answers.",
                  ]
            }
          >
            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>
                {lang === "fr"
                  ? "Dig Deeper — fetchAllPayables"
                  : "Dig Deeper — fetchAllPayables"}
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Avant : chaque tool appelait directement POST /v1/snapshots/payables avec un seul intervalle de dates, sans retry ni découpage → 409 aléatoires."
                  : "Before: each tool called POST /v1/snapshots/payables directly with a single date range, no retries or chunking → random 409 errors."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `// Avant (simplifié)
const snapshot = await api.createPayablesSnapshot({ from, to });
const lines = await api.listPayablesFromSnapshot(snapshot.id);`
                  : `// Before (simplified)
const snapshot = await api.createPayablesSnapshot({ from, to });
const lines = await api.listPayablesFromSnapshot(snapshot.id);`}
              </pre>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginTop: 10,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Après : fetchAllPayables orchestre safeEndDate, splitDateRange, retries 409 et pagination, puis renvoie une liste consolidée prête pour LLM."
                  : "After: fetchAllPayables orchestrates safeEndDate, splitDateRange, 409 retries and pagination, and returns a consolidated list ready for the LLM."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `// Après (vue d’ensemble)
const payables = await fetchAllPayables(api, {
  from: "2026-01-01",
  to:   "2026-03-31",
  filters,
});`
                  : `// After (overview)
const payables = await fetchAllPayables(api, {
  from: "2026-01-01",
  to:   "2026-03-31",
  filters,
});`}
              </pre>
            </div>
          </PhaseSlide>
        )}

        {current === "phase4" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 4" : "Phase 4"}
            title={
              lang === "fr"
                ? "Monitoring & UI d’usage MCP"
                : "Monitoring & MCP usage UI"
            }
            context={
              lang === "fr"
                ? "Comprendre concrètement comment le MCP est utilisé pour piloter la roadmap et la qualité."
                : "Understand how the MCP is actually used to steer roadmap and quality."
            }
            changes={
              lang === "fr"
                ? [
                    "Table mcp_usage_events en SQLite avec logging structuré.",
                    "Instrumentation des requêtes HTTP et des tools (logHttpRequestUsage, logToolCallUsage).",
                    "Dashboard /usage : volume par jour, top tools, derniers appels.",
                  ]
                : [
                    "mcp_usage_events SQLite table with structured logging.",
                    "Instrumentation of HTTP requests and tools (logHttpRequestUsage, logToolCallUsage).",
                    "/usage dashboard: volume by day, top tools, recent calls.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Vision claire des tools et parcours réellement utilisés.",
                    "Détection rapide des erreurs récurrentes ou régressions.",
                    "Meilleure priorisation produit basée sur l’usage réel.",
                  ]
                : [
                    "Clear view of tools and flows actually used.",
                    "Fast detection of recurring errors or regressions.",
                    "Better product prioritisation based on real usage.",
                  ]
            }
          >
            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>
                {lang === "fr"
                  ? "Dig Deeper — Exemple de mcp_usage_events"
                  : "Dig Deeper — Example mcp_usage_events record"}
              </div>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `{
  "id": 1234,
  "ts": "2026-03-01T10:15:23.456Z",
  "method": "tool",
  "tool_name": "spendesk_analyze_spend",
  "category": "analytics",
  "status": "success",
  "duration_ms": 8423,
  "meta": {
    "mcp_session_id": "sess_abc123",
    "from": "2026-01-01",
    "to": "2026-03-31",
    "groupBy": ["supplier", "month"],
    "client": "Claude.ai"
  }
}`
                  : `{
  "id": 1234,
  "ts": "2026-03-01T10:15:23.456Z",
  "method": "tool",
  "tool_name": "spendesk_analyze_spend",
  "category": "analytics",
  "status": "success",
  "duration_ms": 8423,
  "meta": {
    "mcp_session_id": "sess_abc123",
    "from": "2026-01-01",
    "to": "2026-03-31",
    "groupBy": ["supplier", "month"],
    "client": "Claude.ai"
  }
}`}
              </pre>
              <ul style={bullets}>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Chaque ligne relie clairement un appel de tool à un contexte (session, période, client)."
                    : "Each row clearly links a tool call to context (session, period, client)."}
                </li>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Permet de rejouer un use case, détecter les erreurs récurrentes ou comprendre les 0 résultats."
                    : "Allows you to replay a use case, spot recurring errors, or understand zero‑result answers."}
                </li>
              </ul>
            </div>
          </PhaseSlide>
        )}

        {current === "phase5" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 5" : "Phase 5"}
            title={
              lang === "fr"
                ? "Simplification : fin du multi-tenant & portail"
                : "Simplification: removing multi‑tenant & portal"
            }
            context={
              lang === "fr"
                ? "Enlever la complexité qui n’apportait pas de valeur immédiate (portail multi-tenant) pour se concentrer sur le cœur produit."
                : "Remove complexity that didn’t bring immediate value (multi‑tenant portal) to focus on the core product."
            }
            changes={
              lang === "fr"
                ? [
                    "Suppression des tables et APIs clients/companies.",
                    "Retrait du portail /ui.",
                    "Auth simplifiée : client_credentials ou token Bearer, fallback env.",
                  ]
                : [
                    "Drop clients/companies tables and related APIs.",
                    "Remove the /ui portal.",
                    "Simplified auth: client_credentials or bearer token, env fallback.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Architecture plus lisible, moins de surface de bugs.",
                    "Déploiement simplifié (Railway, Docker, etc.).",
                    "Intégration plus simple pour les partenaires et outils internes.",
                  ]
                : [
                    "Cleaner architecture, smaller bug surface.",
                    "Simpler deployment (Railway, Docker, etc.).",
                    "Easier integration for partners and internal tools.",
                  ]
            }
          >
            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>
                {lang === "fr"
                  ? "Dig Deeper — Authentification du MCP"
                  : "Dig Deeper — MCP authentication"}
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Nous avons retenu une auth très simple : token API direct ou client_credentials, sans couche multi-tenant ni gestion de clients/companies en base."
                  : "We kept authentication very simple: direct API token or client_credentials, without a multi‑tenant layer or clients/companies tables."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `Authorization: Bearer SPENDESK_API_TOKEN
ou
Authorization: Bearer client_credentials:base64(client_id:client_secret)`
                  : `Authorization: Bearer SPENDESK_API_TOKEN
or
Authorization: Bearer client_credentials:base64(client_id:client_secret)`}
              </pre>
              <ul style={bullets}>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Bénéfices : onboarding ultra rapide pour les POC, peu de choses à configurer côté client."
                    : "Benefits: very fast onboarding for POCs, almost nothing to configure on the client side."}
                </li>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Limites : pas encore de multi-tenant natif ni de provisioning fin par client."
                    : "Limits: no native multi‑tenant yet and no fine‑grained per‑client provisioning."}
                </li>
              </ul>
            </div>
          </PhaseSlide>
        )}

        {current === "phase6" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 6" : "Phase 6"}
            title={
              lang === "fr"
                ? "Ergonomie LLM : filtres, discovery, self-healing"
                : "LLM ergonomics: filters, discovery, self‑healing"
            }
            context={
              lang === "fr"
                ? "Aider les LLM à utiliser correctement les filtres pour éviter les faux 0 résultats et aligner les différents clients (Dust, Claude, Cursor…)."
                : "Help LLMs use filters correctly to avoid false zero‑results and align behaviour across clients (Dust, Claude, Cursor…)."
            }
            changes={
              lang === "fr"
                ? [
                    "Descriptions de filtres enrichies avec les valeurs enum explicites.",
                    "Description longue et exemples concrets pour spendesk_analyze_spend.",
                    "Nouveau tool spendesk_get_filter_options + self-healing dans plusieurs tools.",
                  ]
                : [
                    "Filter descriptions enriched with explicit enum values.",
                    "Long description and concrete examples for spendesk_analyze_spend.",
                    "New spendesk_get_filter_options tool + self‑healing guidance in several tools.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Moins de 0 résultats trompeurs liés à un mauvais filtre.",
                    "Comportement plus homogène entre les différents clients LLM.",
                    "Moins d’effort côté utilisateur pour « guider » l’IA.",
                  ]
                : [
                    "Fewer misleading zero‑result answers caused by wrong filters.",
                    "More consistent behaviour across LLM clients.",
                    "Less effort required from users to “coach” the AI.",
                  ]
            }
          >
            <AnalyzeSpendExample lang={lang} />
          </PhaseSlide>
        )}

        {current === "phase7" && (
          <PhaseSlide
            phase={lang === "fr" ? "Phase 7" : "Phase 7"}
            title={
              lang === "fr"
                ? "Analytics avancée : SQLite éphémère type Ramp"
                : "Advanced analytics: Ramp‑style ephemeral SQLite"
            }
            context={
              lang === "fr"
                ? "Permettre des analyses comptables/finance très riches via SQL, sans multiplier les tools métiers spécifiques."
                : "Enable rich finance/accounting analyses via SQL without multiplying specific business tools."
            }
            changes={
              lang === "fr"
                ? [
                    "Module SQLite in-memory partagé (payables, settlements, suppliers, purchase_orders).",
                    "4 tools : load_sqlite_data, execute_sql_query, list_loaded_tables, clear_sqlite_tables.",
                    "Tests SQL injection / read-only + doc avec 10 requêtes exemples.",
                  ]
                : [
                    "Shared in‑memory SQLite module (payables, settlements, suppliers, purchase_orders).",
                    "4 tools: load_sqlite_data, execute_sql_query, list_loaded_tables, clear_sqlite_tables.",
                    "SQL injection / read‑only tests + doc with 10 example queries.",
                  ]
            }
            impact={
              lang === "fr"
                ? [
                    "Espace d’exploration analytique très puissant pour les équipes Finance/Compta.",
                    "Pattern réutilisable pour d’autres cas d’usage ou produits.",
                    "Moins de nouveaux endpoints/API à créer pour chaque besoin d’analyse.",
                  ]
                : [
                    "Very powerful analytical playground for Finance/Accounting teams.",
                    "Pattern reusable for other use cases or products.",
                    "Fewer new endpoints/APIs to create for each analysis need.",
                  ]
            }
          >
            <SqliteWorkflowExample lang={lang} />
            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>
                {lang === "fr"
                  ? "Dig Deeper — Modèle SQLite éphémère"
                  : "Dig Deeper — Ephemeral SQLite model"}
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Avant : chaque question complexe nécessitait un nouveau tool ou endpoint spécifique."
                  : "Before: each complex question required a new dedicated tool or API endpoint."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `// Avant : tool spécifique
spendesk_analyze_spend({ from, to, groupBy: "supplier" });`
                  : `// Before: specific tool
spendesk_analyze_spend({ from, to, groupBy: "supplier" });`}
              </pre>
              <p
                style={{
                  fontSize: 13,
                  color: spendeskColors.textSecondary,
                  marginTop: 10,
                  marginBottom: 6,
                }}
              >
                {lang === "fr"
                  ? "Après : on charge les données une fois en SQLite, puis on laisse le LLM explorer en SQL (read-only, limité à 1000 lignes)."
                  : "After: we load the data once into SQLite, then let the LLM explore via SQL (read‑only, limited to 1000 rows)."}
              </p>
              <pre style={codeBlock}>
                {lang === "fr"
                  ? `spendesk_load_sqlite_data({ dataset: "payables", from_date, to_date });
spendesk_execute_sql_query({ sql: "SELECT ... GROUP BY supplier, month" });`
                  : `spendesk_load_sqlite_data({ dataset: "payables", from_date, to_date });
spendesk_execute_sql_query({ sql: "SELECT ... GROUP BY supplier, month" });`}
              </pre>
              <ul style={bullets}>
                <li style={bulletItem}>
                  {lang === "fr"
                    ? "Garde-fous : requêtes SELECT/ WITH uniquement, pas d’INSERT/UPDATE/DELETE, max 1000 lignes retournées."
                    : "Guardrails: only SELECT/WITH queries, no INSERT/UPDATE/DELETE, max 1000 rows returned."}
                </li>
              </ul>
            </div>
          </PhaseSlide>
        )}

        {current === "conclusion" && <ConclusionSlide lang={lang} />}

        <div style={navBar}>
          <div style={navButtons}>
            <button
              type="button"
              onClick={goPrev}
              disabled={currentIndex === 0}
              style={{
                ...navButton,
                opacity: currentIndex === 0 ? 0.4 : 1,
                cursor: currentIndex === 0 ? "default" : "pointer",
              }}
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex === SLIDES.length - 1}
              style={{
                ...navButtonPrimary,
                opacity: currentIndex === SLIDES.length - 1 ? 0.4 : 1,
                cursor:
                  currentIndex === SLIDES.length - 1 ? "default" : "pointer",
              }}
            >
              Suivant
            </button>
          </div>
          <div style={slideIndexText}>
            Phase : {current === "intro" || current === "conclusion"
              ? current
              : current.toUpperCase()}
          </div>
        </div>
      </main>
    </div>
  );
}

