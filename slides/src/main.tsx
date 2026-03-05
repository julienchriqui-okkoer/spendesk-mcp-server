import React from "react";
import ReactDOM from "react-dom/client";
import { McpSpendeskDeck } from "./McpSpendeskDeck";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <McpSpendeskDeck />
    </React.StrictMode>
  );
}

