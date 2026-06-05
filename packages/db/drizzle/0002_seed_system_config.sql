-- ────────────────────────────────────────────────────────────────────────────
-- Seed `system_config.workflow_defaults`.
--
-- This row is the template for every NEW tenant's `workflow` row. Editing
-- this seed does NOT propagate to existing tenants — once a tenant exists,
-- its workflow row is its own. Super-admin updates via the
-- `system.config.update` RPC mutate this row for FUTURE tenants only.
--
-- JSON shape must match `SystemConfig.SystemWorkflowDefaults` (TaggedStruct
-- with `_tag = "workflow_defaults"`). Parity is asserted by the domain↔db
-- parity test on every CI run.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO system_config (key, value, updated_at) VALUES (
  'workflow_defaults',
  $json${
    "_tag": "workflow_defaults",
    "statuses": [
      { "key": "open",                "label": "Open",                "color": "#3b82f6", "terminal": false },
      { "key": "in_progress",         "label": "In Progress",         "color": "#f59e0b", "terminal": false },
      { "key": "waiting_on_customer", "label": "Waiting on Customer", "color": "#a855f7", "terminal": false },
      { "key": "resolved",            "label": "Resolved",            "color": "#10b981", "terminal": false },
      { "key": "closed",              "label": "Closed",              "color": "#6b7280", "terminal": true  }
    ],
    "priorities": [
      { "key": "low",    "label": "Low",    "color": "#6b7280", "weight": 0  },
      { "key": "normal", "label": "Normal", "color": "#3b82f6", "weight": 10 },
      { "key": "high",   "label": "High",   "color": "#f59e0b", "weight": 20 },
      { "key": "urgent", "label": "Urgent", "color": "#ef4444", "weight": 30 }
    ],
    "transitions": [
      { "from": "open",                "to": "in_progress"         },
      { "from": "open",                "to": "closed"              },
      { "from": "in_progress",         "to": "waiting_on_customer" },
      { "from": "in_progress",         "to": "resolved"            },
      { "from": "in_progress",         "to": "open"                },
      { "from": "waiting_on_customer", "to": "in_progress"         },
      { "from": "waiting_on_customer", "to": "resolved"            },
      { "from": "resolved",            "to": "closed"              },
      { "from": "resolved",            "to": "in_progress"         }
    ],
    "types": [
      { "key": "question",        "label": "Question",        "color": "#3b82f6", "icon": "circle-help", "defaultPriority": "normal" },
      { "key": "bug",             "label": "Bug",             "color": "#ef4444", "icon": "bug",         "defaultPriority": "high"   },
      { "key": "feature_request", "label": "Feature Request", "color": "#10b981", "icon": "lightbulb",   "defaultPriority": "low"    },
      { "key": "incident",        "label": "Incident",        "color": "#dc2626", "icon": "siren",       "defaultPriority": "urgent" }
    ],
    "tags": [
      { "key": "billing",    "label": "Billing",    "color": "#a855f7" },
      { "key": "vip",        "label": "VIP",        "color": "#fbbf24" },
      { "key": "regression", "label": "Regression", "color": "#dc2626" }
    ],
    "defaultStatus":   "open",
    "defaultPriority": "normal",
    "defaultTypeKey":  null
  }$json$::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
