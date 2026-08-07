# CONTEXT.md

Fichier de contexte de la fenêtre de travail. À relire au début de chaque tâche.
Toute information ajoutée ici doit être vérifiée dans le code ou dans les briefs. Aucune supposition.

---

## 1. Objet

Déployer **Velmo 2.0** (agent de support IA de la boutique de maillots collector Velmo) sur Azure.
L'agent fonctionne aujourd'hui en local uniquement. La mémoire long terme est dans un fichier local,
donc perdue au changement de machine.

Ce qui marchait en local doit marcher en ligne, sans dégradation des garde-fous ni de la mémoire.

## 2. Exigences reprises du brief

| Réf | Exigence                                           | Vérification attendue                                                            |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| R2  | Persistance de la mémoire long terme inter-session | Un fait donné en session 1 est retrouvé en session 2                             |
| R3  | Isolation stricte par utilisateur                  | Un second utilisateur n'a pas accès aux faits du premier                         |
| G   | Garde-fous entrée et sortie effectifs en ligne     | Message à bloquer, injection de prompt, PII en sortie : blocage + journalisation |
| S   | Aucun secret dans le code source                   | Rien dans le dépôt Git, tout externalisé côté Azure                              |

## 3. Périmètre imposé (ne pas en sortir)

Les services et mécanismes autorisés sont **exclusivement** ceux nommés dans le brief et dans la
ressource formateur « Les bases d'Azure ». Toute proposition hors de cette liste est à rejeter,
même si elle est techniquement meilleure.

**Autorisé**
- Un groupe de ressources unique (ex. `rg-velmo-prod`), région **France Central** ou **Sweden Central**.
- Hébergement : **Azure App Service** (recommandé par la ressource) ou **conteneur** (Container Apps).
  Le brief demande de comparer les deux sur facilité, coût, adéquation, puis de justifier le choix.
- Service d'IA : **Azure OpenAI / Azure AI Foundry**, avec déploiement d'un modèle dans le service.
- Mémoire persistante : « base de données / stockage managé Azure ». Le brief ne nomme aucun service
  précis. Le choix doit être justifié au regard de R2 et R3.
- Secrets : **Paramètres d'application** (Application settings) de l'App Service, **et/ou coffre de
  secrets** (Azure Key Vault). Ces deux mécanismes sont explicitement cités par le brief.
- Suivi : **Log stream** de l'App Service, **Cost Management** pour le crédit.

**Hors périmètre**
- Machine virtuelle : écartée par la ressource formateur (trop complexe pour ce niveau).
- Identité managée et RBAC : non mentionnées par le brief ni par la ressource. Ne pas les introduire.
- Tout service Azure non cité ci-dessus (Front Door, API Management, VNet, Application Gateway, etc.).

## 4. Contrainte de coût

- Abonnement sur un **plan payant basique, budget serré** (compte Azure for Students, 100 $ de crédit).
- Plan App Service retenu : **Basic (B1)**, et non F1. B1 apporte Always On, donc pas de démarrage à
  froid pendant la démonstration au commanditaire. Le surcoût par rapport à F1 est assumé.
- Toutes les ressources dans **un seul groupe de ressources**, pour pouvoir tout supprimer d'un coup
  à la fin du brief. Une ressource arrêtée peut continuer à coûter : supprimer plutôt qu'arrêter.
- Pour le stockage mémoire et le service d'IA : privilégier les niveaux les moins chers compatibles
  avec R2 et R3, et documenter le coût mensuel estimé dans `dossier-deploiement/01-choix-services.md`.
- Surveiller la consommation dans Cost Management à chaque session de travail.

## 5. État de la source Velmo 2.0

**Renseigné par analyse du dépôt en lecture seule le 2026-07-27.** Références de la forme
`fichier:ligne` pour tout fait vérifié. Les rares points non tranchables par le code restent
marqués `INCONNU` et sont listés en section 8.

Dépôt source : `../TP7_Reconstruire-agent-de-zero_(memoire, garde-fous et MLOps)/velmo-v2`

### 5.1 Application
- Framework web exposé : **Streamlit** (`scripts/chat_app.py`, cible `make chat-ui`). Le cœur testé
  est un **REPL CLI** (`src/velmo/cli.py`, `python -m velmo.cli`). Une variante **LangChain/LangGraph**
  existe (`scripts/agent_langchain.py`) mais est indépendante du cœur et optionnelle.
- Point d'entrée et démarrage : CLI = `python -m velmo.cli` ; interface web = `streamlit run
  scripts/chat_app.py`. Le `Dockerfile` lance par défaut le CLI (`CMD ["uv","run","python","-m","velmo.cli"]`),
  pas Streamlit. Aucun port HTTP n'est exposé par le CLI ; **Streamlit écoute par défaut sur 8501**.
- Version de Python : **3.11** (`pyproject.toml` : `requires-python = ">=3.11,<3.12"`). Dépendances
  gérées par **uv** (`uv.lock`), build `hatchling`.
- Dépendances système non-Python : **aucune dans le cœur**. La seule lourdeur native vient de l'extra
  `vector` (`chromadb`, `sentence-transformers` → **PyTorch ~2,5 Go**) et d'un **serveur Chroma**
  séparé (`docker-compose.yml`). Le `Makefile` exclut volontairement `vector` de l'installation courante.
- WebSockets / streaming : **oui**, Streamlit s'appuie sur des WebSockets (Tornado). **Rien à
  activer** : ils sont toujours actifs sur App Service Linux, l'interrupteur « Web sockets » du
  portail ne visant que Windows (FAQ App Service sur Linux, vérifié le 2026-08-07).

### 5.2 Agent
- Orchestration : `src/velmo/agent.py`, classe `Agent.respond` → `_respond`. La chaîne imposée est
  déjà câblée dans cet ordre exact : `guardrails.check_input` (l.111) → `memory.read` (l.125) →
  routage/outils/LLM `_handle` (l.135) → `guardrails.check_output` (l.148) → `memory.write` (l.157).
  Repli technique poli (`TECHNICAL_FALLBACK`) si une dépendance externe tombe (l.136-139).
- Outils de lecture implémentés : `get_order`, `track_shipment`, `check_stock`, `search_kb`
  (`src/velmo/tools/`).
- Outils d'action implémentés : `update_order_item`, `cancel_order`, `create_return`,
  `trigger_refund`, `escalate_to_human` (+ `update_shipping_address`).
- Client LLM actuel : `src/velmo/llm.py`. Client **OpenAI-compatible** (`openai.OpenAI(base_url=...)`)
  pointant un endpoint **Azure AI Foundry / Azure OpenAI** finissant par `/openai/v1`. Repli hors-ligne
  déterministe `EchoLLM` si `AZURE_AI_INFERENCE_ENDPOINT` absent. Client Langfuse optionnel.

### 5.3 Mémoire

**Mémoire de fil de conversation (court terme)**
- Technologie actuelle : table relationnelle `messages` (`src/velmo/memory/models.py`, classe `Message`).
- Schéma : `user_id`, `session_id`, `turn_index`, `role`, `content`, `created_at`.
- Portée : **par (user_id, session_id)**. Fenêtre `RECENT_MESSAGES = 60` = 30 tours (R1).

**Mémoire long terme (faits durables du client)**
- Technologie actuelle : table relationnelle `faits_semantiques` (`models.py`, classe `FaitSemantique`),
  stockée dans un **fichier SQLite** `data/velmo_memory.sqlite` (`memory_session_factory` :
  `create_engine(f"sqlite:///{db_path}")`, l.142). Chemin résolu via env `VELMO_MEMORY_DB` ou défaut
  `data/velmo_memory.sqlite`. **Base distincte** de la base applicative Postgres (`db.py`, `DB_URL`).
  C'est le « fichier local perdu au changement de machine » visé par le brief.
- Schéma : `user_id`, `type`, `value`, `statut`, `source`, `confidence`, `created_at`, `updated_at`.
  Écriture par règles d'upsert D18 (mono-valeur = remplace, multi-valeur = insère).
- Isolation par utilisateur : **filtre `filter_by(user_id=...)` sur chaque lecture et chaque écriture**
  (`memory/__init__.py` : `_facts_dict` l.160-163, `read` l.181, `_upsert_fact` l.104, `forget` l.222).
- **Recherche sémantique par embeddings ? NON pour la mémoire long terme.** Les faits sont extraits par
  **règles regex** (`_RULES`, `memory/__init__.py` l.63-70), pas par embeddings. La recherche épisodique
  vectorielle est **conçue mais non implémentée** (`read` : « vectoriel, non testé ici » ; `inspect`
  renvoie `episodic: []`). Le vectoriel (Chroma + e5) ne sert **que** à la FAQ RAG (`kb_store.py`),
  qui ne fait pas partie des trois exigences non négociables.

  **Conséquence pour le choix Azure : le stockage mémoire cible n'a besoin d'aucun service vectoriel.
  Une base relationnelle managée (Azure Database for PostgreSQL) suffit pour R2 et R3, et le code la
  parle déjà (SQLAlchemy + psycopg).**

- **Adaptation de code nécessaire** : `memory_session_factory` code en dur `sqlite:///`. Pour brancher
  la mémoire sur Postgres managé, il faut qu'elle accepte une **URL de connexion** venant d'un secret,
  comme le fait déjà `db.py` avec `DB_URL`. C'est la seule vraie modification pour satisfaire R2.

Point de vigilance confirmé : R3 est un **invariant du code**, pas une propriété du service. Le
changement de backend SQLite → Postgres ne doit pas casser le filtre `user_id`, et le test
d'acceptance doit le prouver.

### 5.4 Garde-fous
- Emplacement : `src/velmo/guardrails/__init__.py`, classe `GuardrailEngine`. Défense à **deux lignes**.
- Garde-fou d'entrée : `check_input` (l.186). 1re ligne = cascade regex déterministe sur texte normalisé
  (accents/casse), catégories `secret_leak, prompt_injection, hate, violence, sexual, out_of_scope`
  (l.58-82). 2e ligne = LLM-juge optionnel (`moderator`), **désactivé par défaut** (`version.yaml`
  `moderator: false`).
- Garde-fou de sortie : `check_output` (l.205). PII à format fixe (IBAN, carte, mot de passe) l.219,
  puis secret/toxicité, puis LLM-juge restreint (`secret_leak, hate, violence, sexual, pii`) sur le
  seul texte généré par le modèle.
- Journalisation des blocages : liste **en mémoire** `GuardrailEngine.events` (`_log`, l.164), avec
  PII/secret masqués (`"[masqué]"`). **Pas encore sur `stdout`.** Point d'action prod : pour voir les
  blocages dans le **Log stream** Azure, émettre aussi les événements sur la sortie standard.
- Seuils codés en dur à externaliser : **`REFUND_CAP = 50.0`** (`src/velmo/tools/_common.py:11`),
  `token_budget = 2000` et `RECENT_MESSAGES = 60` (mémoire), `EVAL_MIN_SCORE = 0.8` (CI).
- Autres règles d'escalade : remboursement > 50 € (`tools/refunds.py`), commande déjà expédiée,
  litige d'authenticité ; isolation propriétaire via `owned_order` (R3 métier).

### 5.5 Configuration actuelle
- Variables lues depuis `.env` (`.env.example`) : `AZURE_AI_INFERENCE_ENDPOINT`,
  `AZURE_AI_INFERENCE_API_KEY`, `AZURE_AI_INFERENCE_MODEL`, `AZURE_JUDGE_ENDPOINT`, `AZURE_JUDGE_API_KEY`,
  `AZURE_JUDGE_MODEL`, `DB_URL`, `CHROMA_URL`, `EMBEDDING_MODEL`, `EVAL_MIN_SCORE`. Également lues dans le
  code : `VELMO_MEMORY_DB` (chemin mémoire), `LANGFUSE_PUBLIC_KEY` (observabilité optionnelle).
- Valeurs codées en dur : `REFUND_CAP = 50.0` (`tools/_common.py:11`), `RECENT_MESSAGES = 60`,
  `token_budget = 2000` (défauts), modèle de repli `gpt-5.6-terra` (`llm.py:86`).
- `.env` correctement ignoré par Git : **oui** (`.gitignore` l.24, et `git ls-files` ne suit que
  `.env.example`).
- Secret déjà commité dans l'historique Git : **non détecté** (`git log -S` sur les clés : aucun
  résultat ; pas de `.env` dans l'historique).

## 6. Règles de travail

1. **Ne jamais modifier le dépôt source TP7.** Lecture seule. Les adaptations de code se font dans
   une copie ou une branche dédiée, décidée après validation du dossier de déploiement.
2. **Ne rien inventer.** Une information absente du code ou des briefs est notée `INCONNU` et
   remontée en section 8, pas comblée par une hypothèse plausible.
3. **Respecter la porte d'entrée.** Aucune ressource Azure n'est créée tant que le dossier de
   déploiement n'est pas validé par le formateur.
4. **Aucun secret dans les fichiers produits ici.** Ni clé, ni chaîne de connexion, ni endpoint réel.
   Utiliser des marqueurs de la forme `<A_RENSEIGNER_DANS_APP_SETTINGS>`.
5. **Tracer au fil de l'eau.** Chaque manipulation dans le portail Azure est notée immédiatement dans
   `runbook/`, avec le nom exact des ressources créées. Le runbook n'est pas rédigé après coup.
6. **Une tâche à la fois.** Ne pas produire les trois documents du dossier de déploiement en un seul
   passage.
7. **Rituel en trois temps : proposer, s'autocritiquer, formaliser.** Aucun livrable n'est écrit d'un
   seul jet. On expose d'abord l'intention, puis on cherche soi-même ce qui ne tient pas — argument
   fragile, preuve manquante, périmètre qui dérive — et seulement ensuite on formalise la version
   retenue. L'autocritique est un temps obligatoire, pas une formule de politesse : si elle ne
   trouve rien, c'est qu'elle n'a pas été faite.

## 7. Avancement

Phase en cours : **conception terminée, dossier prêt à soumettre**. Aucune ressource Azure
provisionnée. Dernière mise à jour : **2026-08-07**.

| #   | Attendu du brief                                 | Livrable                                                                                                                     | État                                                                        |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0   | Inventaire du code existant                      | `CONTEXT.md` section 5                                                                                                       | **fait**                                                                    |
| 1   | Choix des services Azure                         | `dossier-deploiement/01-choix-services.md`                                                                                   | **fait** — App Service B1, PostgreSQL Flexible Server, Azure AI Foundry     |
| 2   | Gestion des secrets et de la configuration       | `dossier-deploiement/02-secrets-et-config.md`                                                                                | **fait** — inventaire reconstruit depuis le code et revérifié le 2026-08-07 |
| 3   | Schéma de déploiement cible                      | `dossier-deploiement/03-schema-cible.md` + `diagrammes/` (4 vues : sources `.mermaid`, images `.svg`, outil de régénération) | **fait**                                                                    |
|     | **Validation formateur (porte d'entrée)**        | `dossier-deploiement/00-questions-formateur.md`                                                                              | **à soumettre — étape en cours**                                            |
| 4   | Provisionner les ressources Azure                | `infra/` + `preuves/`                                                                                                        | bloqué par la validation                                                    |
| 5   | Déployer l'agent et le connecter au service d'IA | URL publique                                                                                                                 | bloqué par la validation                                                    |
| 6   | Mémoire long terme persistante et isolée         | preuve R2 + R3                                                                                                               | bloqué par la validation                                                    |
| 7   | Vérifier garde-fous et secrets en production     | `preuves/`                                                                                                                   | bloqué par la validation                                                    |
| 8   | Premiers signaux de suivi                        | relevé latence, coût, taux de blocage                                                                                        | bloqué par la validation                                                    |
| 9   | Documenter et présenter                          | `runbook/` + `pitch-soutenance.md`                                                                                           | trame de soutenance ébauchée, à réviser sur constats réels                  |

**Adaptations de code à faire après validation** (dans une copie, jamais dans TP7 — règle 1) :

| Adaptation                                      | Emplacement                                       | Pourquoi                                                                     |
| ----------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accepter une URL de connexion pour la mémoire   | `memory/models.py:127-145`, figé sur `sqlite:///` | Sans elle, **R2 est indémontrable**                                          |
| Émettre les blocages de garde-fous sur `stdout` | `guardrails/__init__.py:161-171`                  | Sans elle, rien de visible dans le Log stream (points 7 et 8)                |
| Externaliser le seuil de remboursement          | `tools/_common.py:11` (`REFUND_CAP = 50.0`)       | Exigence du brief : les seuils de garde-fous sont configurables hors du code |
| Compléter `.env.example`                        | dépôt TP7                                         | Documentation des noms de paramètres, sans valeur                            |

## 8. Questions ouvertes

- ~~**Hébergement App Service vs conteneur.**~~ **Tranché le 2026-08-07** : App Service, option (a).
  L'arbitrage reposait sur la crainte de perdre la FAQ qui « marchait en local ». Vérification au
  code : `get_kb()` retombe sur `LocalKB`, une recherche lexicale sans dépendance, dès que
  `CHROMA_URL` est absente (`kb_store.py:107-118`). La FAQ reste donc servie en ligne ; seule la
  tolérance aux paraphrases est perdue. Le conteneur n'a plus d'argument fonctionnel décisif.
  **Condition de déploiement** : inclure `kb/docs/` et exécuter depuis l'arborescence du dépôt
  (`kb_store.py:15` résout un chemin relatif au dépôt, absent de la roue `pyproject.toml:50-51` et
  du `Dockerfile`) — sinon la FAQ est vide sans qu'aucune erreur ne soit levée.
- **Nom exact du modèle déployé** dans Azure OpenAI / AI Foundry : à fixer au provisionnement
  (incohérences dans le dépôt : `grok-4.3`, `gpt-5.4-mini`, défaut `gpt-5.6-terra`, README « Kimi-K2.6 »).
  C'est de la config, pas un secret.
- **Émission des blocages de garde-fous sur `stdout`** pour le Log stream Azure : petite addition de
  code à prévoir (aujourd'hui les blocages ne vivent que dans `GuardrailEngine.events`).

## 9. Livrables attendus

- URL publique de Velmo 2.0 déployé.
- Dossier de déploiement : schéma cible, liste des secrets externalisés, plan de la mémoire persistante.
- Dépôt Git à jour et runbook « Déployer et exploiter Velmo 2.0 sur Azure ».
- Capture du portail Azure montrant le groupe de ressources (hébergement, stockage mémoire, Azure OpenAI).
- Court relevé des signaux de suivi : latence, coût indicatif, taux de blocage des garde-fous.
- Soutenance de 5 à 10 minutes devant un pair jouant la CTO.

Évaluation : validation du dossier de déploiement, tests d'acceptance en ligne, revue de code et
démonstration depuis l'URL publique, auto-évaluation et co-évaluation Simplonline.
