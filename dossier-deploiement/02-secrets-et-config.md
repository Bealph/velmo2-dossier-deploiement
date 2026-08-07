# 2. Gestion des secrets et de la configuration

> Attendu du brief : définir comment les secrets sont configurés hors du code.
> Critères d'évaluation : la liste des secrets à externaliser est **complète**, et le mécanisme de
> stockage côté Azure est décrit et **exclut toute présence dans le code source**.
>
> **Ce document ne contient aucune valeur réelle.** Uniquement des noms de paramètres et des
> marqueurs `<A_RENSEIGNER_DANS_APP_SETTINGS>`.

Méthode retenue pour garantir l'exhaustivité : plutôt que de recopier `.env.example`, l'inventaire
est établi par **balayage systématique du code** de toutes les lectures d'environnement
(`os.getenv`, `os.environ`) et des constantes en dur. Chaque ligne renvoie à `fichier:ligne`.
Cette méthode a fait apparaître **quatre variables absentes de `.env.example`** et **deux
variables déclarées mais jamais lues** (§2.5).

---

## 2.1 Inventaire des valeurs à externaliser

### A. Secrets (valeur confidentielle)

| Paramètre                    | Rôle                         | Lu dans le code                      | À renseigner |
| ---------------------------- | ---------------------------- | ------------------------------------ | ------------ |
| `AZURE_AI_INFERENCE_API_KEY` | clé du service d'IA          | `llm.py:84`, `moderator.py:83`       | **oui**      |
| `DB_URL`                     | connexion base métier        | `db.py:168`, `alembic/env.py:16,24`  | **oui**      |
| `VELMO_MEMORY_DB_URL`        | connexion base mémoire       | **à créer** (`memory/models.py:120`) | **oui**      |
| `AZURE_JUDGE_API_KEY`        | clé du LLM-juge dédié        | `moderator.py:83`                    | non (§2.3)   |
| `LANGFUSE_SECRET_KEY`        | clé privée du collecteur     | jamais — lue par le SDK              | non          |
| `LANGFUSE_PUBLIC_KEY`        | interrupteur d'observabilité | `llm.py:79`, `observability.py:77`   | non (§2.3)   |

Tous les paramètres marqués « oui » vont dans les **paramètres d'application** de l'App Service.

**Origine des valeurs.** Les deux clés d'IA se relèvent dans le portail Azure AI Foundry, ressource
`oai-velmo-prod`, section Clés. Les deux chaînes de connexion se construisent à partir du serveur
`psql-velmo-prod` — base `velmo` pour le métier, `velmo_memory` pour la mémoire. Les clés Langfuse
viennent d'un compte tiers et **ne doivent pas être renseignées** : l'observabilité est hors périmètre.

**Pourquoi les URL de connexion sont des secrets.** `DB_URL` et `VELMO_MEMORY_DB_URL` contiennent
l'utilisateur **et le mot de passe**. Elles relèvent donc du secret et non de la configuration, même
si leur nom évoque une simple URL. C'est exactement ce que le brief désigne par « connexion au
stockage mémoire ».

**Deux pièges de lecture.** `AZURE_AI_INFERENCE_API_KEY` est lue par `os.environ[...]` et non par
`os.getenv` : son absence lève une exception dès qu'un endpoint est défini. À l'inverse,
`LANGFUSE_SECRET_KEY` n'apparaît **nulle part** dans le code — c'est le SDK Langfuse qui la lit dans
l'environnement. Un inventaire construit par recherche de `os.getenv` seule l'aurait manquée.

### B. Paramètres de configuration (non confidentiels, mais hors du code)

| Paramètre                     | Rôle                           | Lu dans le code                       | Valeur cible                |
| ----------------------------- | ------------------------------ | ------------------------------------- | --------------------------- |
| `AZURE_AI_INFERENCE_ENDPOINT` | endpoint du service d'IA       | `llm.py:68`                           | URL en `/openai/v1`         |
| `AZURE_AI_INFERENCE_MODEL`    | nom du déploiement du modèle   | `llm.py:86`                           | à fixer au provisionnement  |
| `AZURE_JUDGE_ENDPOINT`        | endpoint du LLM-juge           | `moderator.py:82`                     | non renseigné (§2.3)        |
| `AZURE_JUDGE_MODEL`           | modèle du LLM-juge             | `moderator.py:93`                     | **décision requise** (§2.3) |
| `VELMO_REFUND_CAP`            | seuil d'escalade remboursement | **à créer** (`tools/_common.py:11`)   | `50`                        |
| `VELMO_RECENT_MESSAGES`       | fenêtre d'historique (R1)      | **à créer** (`memory/__init__.py:85`) | `60`                        |
| `VELMO_TOKEN_BUDGET`          | budget de contexte mémoire     | **à créer** (`memory/__init__.py:87`) | `2000`                      |
| `CHROMA_URL`                  | serveur de la FAQ vectorielle  | `kb_store.py:89,113`                  | non renseigné (doc 01 §1.1) |
| `EMBEDDING_MODEL`             | modèle d'embeddings de la FAQ  | `kb_store.py:102`                     | non renseigné, même raison  |

**Trois interrupteurs déguisés en configuration.** `AZURE_AI_INFERENCE_ENDPOINT` absent fait basculer
l'agent sur le repli hors-ligne `EchoLLM`. `CHROMA_URL` absent fait basculer la FAQ sur le repli
lexical `LocalKB`. `LANGFUSE_PUBLIC_KEY` absente désactive toute l'observabilité. Ces trois valeurs ne
règlent pas un comportement : elles en **choisissent** un.

**Défauts en dur à connaître.** `AZURE_AI_INFERENCE_MODEL` vaut `gpt-5.6-terra` par défaut et
`AZURE_JUDGE_MODEL` vaut `gpt-5.4-mini` : deux noms qui ne correspondront probablement à aucun
déploiement réel. Les renseigner explicitement évite un échec au premier appel.

### C. Paramètres propres à la plateforme App Service

| Nom du paramètre                      | Rôle                                                    | Valeur cible                                                               |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `WEBSITES_PORT`                       | Port sur lequel l'application écoute (Streamlit)        | à aligner sur la commande de démarrage                                     |
| `SCM_DO_BUILD_DURING_DEPLOYMENT`      | Déclenche l'installation des dépendances au déploiement | `true`                                                                     |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | Persistance du disque local                             | sans objet : aucune donnée durable ne doit vivre sur le disque (voir §2.6) |

### D. Valeurs qui restent **délibérément** dans le code

L'inventaire n'est complet que s'il justifie aussi ce qu'on **n'externalise pas**.

| Valeur                            | Emplacement                                        | Raison                     |
| --------------------------------- | -------------------------------------------------- | -------------------------- |
| Motifs regex des garde-fous       | `guardrails/__init__.py:58-112`                    | non désactivable (a)       |
| Planchers de la porte qualité     | `mlops/__init__.py:217-227`                        | invariant, pas réglage (b) |
| Statuts métier modifiables        | `tools/_common.py:13-14`                           | règle structurelle (c)     |
| Messages de refus, prompt système | `guardrails/__init__.py:118-137`, `agent.py:19-29` | contenu versionné (d)      |

**(a)** Choix de conception explicite du TP7 : « des règles en CODE, hors du LLM, qu'aucun message ne
peut désactiver ». Les externaliser créerait à la fois une surface d'attaque et une voie de
désactivation — exactement ce que les garde-fous doivent empêcher.

**(b)** Faux positifs à zéro, mémoire ≥ 90 %, blocage ≥ 95 %. Documentés comme « invariants de
conception, pas des réglages d'exécution » (`score.py:10-12`).

**(c)** Une commande expédiée n'est plus modifiable : c'est une règle métier, pas un seuil à ajuster.

**(d)** `version.yaml` définit une version comme le triplet prompt + mémoire + garde-fous. Sortir ces
contenus du dépôt casserait la traçabilité des versions mise en place au TP7.

## 2.2 Mécanisme de stockage côté Azure

### Solution retenue : **paramètres d'application (Application settings) de l'App Service, sans coffre de secrets**

Le brief autorise les paramètres d'application « et/ou » un coffre de secrets. Les deux sont donc
recevables ; le choix doit être argumenté.

**Justification du choix**

1. **Le coffre de secrets ne serait pas cohérent avec le périmètre imposé.** Azure Key Vault ne
   prend tout son sens qu'associé à une **identité managée**, qui permet à l'App Service de lire le
   coffre sans identifiant. Or `CONTEXT.md` §3 place explicitement l'identité managée et RBAC hors
   périmètre (non mentionnées par le brief ni par la ressource formateur). Sans identité managée, il
   faudrait stocker quelque part un identifiant d'accès au coffre : on déplacerait le secret sans le
   supprimer, pour un gain nul et une complexité réelle.
2. **C'est le mécanisme enseigné par la ressource formateur**, qui décrit la procédure exacte
   (« Configuration → Paramètres d'application ») et pose la règle : « Ne mettez JAMAIS une clé
   secrète directement dans le code ou sur GitHub. Les clés se rangent dans les Paramètres
   d'application d'Azure. »
3. **Le critère d'évaluation est satisfait** : les paramètres d'application sont stockés **côté
   Azure**, chiffrés au repos, hors du dépôt Git, et modifiables sans redéployer le code.
4. **Aucune modification de code n'est nécessaire.** App Service **injecte** les paramètres
   d'application comme **variables d'environnement** du processus. Le code lit déjà tout par
   `os.getenv` / `os.environ` : il fonctionne à l'identique en local et en ligne.

**Évolution documentée** : si le projet devait passer à un vrai environnement de production
multi-équipes, Key Vault plus identité managée serait la étape suivante (rotation centralisée,
traçabilité des accès, aucun secret visible dans le portail). Ce n'est pas justifié à ce stade.

### Comment l'application lit ces valeurs à l'exécution

Chaîne complète, sans rupture :

```
Portail Azure : App Service > Configuration > Paramètres d'application
        (stockage chiffré côté Azure, hors dépôt Git)
                    |
                    v  injection au démarrage du conteneur applicatif
        Variables d'environnement du processus Python
                    |
                    v  os.getenv / os.environ  (code inchangé)
        llm.py:68,84,86 · db.py:168 · memory/models.py · moderator.py:82,83,93
```

**Point vérifié** : les points d'entrée appellent `load_dotenv()` (`cli.py:30`, `chat_app.py:32`).
En l'absence de fichier `.env` — ce qui sera le cas sur Azure, puisque `.env` est exclu du dépôt —
l'appel est **sans effet** et n'écrase aucune variable d'environnement déjà présente. Le code
fonctionne donc tel quel en ligne, sans adaptation de la configuration.

### Procédure exacte dans le portail

1. App Service `app-velmo-prod` → **Configuration** → **Paramètres d'application**.
2. **+ Nouveau paramètre d'application** pour chaque ligne du tableau §2.4.
3. **Enregistrer** — l'application **redémarre** automatiquement, ce qui applique les valeurs.
4. Contrôler dans **Log stream** que le démarrage se passe sans erreur de configuration.
5. Consigner dans le runbook la **liste des noms** saisis, **jamais les valeurs**.

## 2.3 Trois décisions de configuration à acter

Ces points sont issus de la lecture du code et n'apparaissent pas dans le brief. Ils doivent être
tranchés avant le provisionnement, car ils ont un effet direct en production.

### Décision 1 — Le LLM-juge s'activerait tout seul en production

**Constat.** `get_moderator()` (`moderator.py:82-85`) utilise `AZURE_JUDGE_*` **si présentes, sinon
retombe sur `AZURE_AI_INFERENCE_*`**. Or `build_default_agent` injecte systématiquement
`GuardrailEngine(moderator=get_moderator())` (`agent.py:348`). Conséquence : dès que l'endpoint et
la clé du service d'IA principal sont renseignés — ce qui est indispensable — **le LLM-juge devient
actif**, alors que `version.yaml:26` déclare `moderator: false`. Ce fichier n'est qu'une
description de version : il ne pilote rien.

**Effet si on ne fait rien.** Le juge appellerait le modèle `gpt-5.4-mini` (défaut
`moderator.py:93`), qui ne sera **pas** déployé dans notre ressource. Chaque appel échouerait, le
mécanisme de **fail-open** renverrait `None` (`moderator.py:63-64`), donc les garde-fous resteraient
sûrs — mais on paierait un appel réseau inutile et de la latence à chaque tour généré par le modèle.

**Options.**

| Option                                     | Effet                                  | Coût                            |
| ------------------------------------------ | -------------------------------------- | ------------------------------- |
| **(a)** renseigner `AZURE_JUDGE_MODEL`     | juge actif, garde-fous renforcés       | 1 appel LLM par tour généré     |
| (b) ne rien renseigner                     | juge appelé mais toujours en échec     | latence et appels inutiles      |
| (c) interrupteur `VELMO_MODERATOR_ENABLED` | comportement conforme à `version.yaml` | une petite modification de code |

L'option (a) demande le nom du modèle réellement déployé, et coûte environ 1 s de latence
supplémentaire par tour d'après ce qui a été observé en local. L'option (b) échoue en *fail-open* :
le juge est appelé, il échoue, et rien ne bloque.

**Recommandation : (a)**, en pointant le juge sur le **même** déploiement que l'agent. Aucun second
modèle à déployer, la 2e ligne de garde-fous devient réellement effective en ligne — un atout pour
le point 7 du brief — et l'on évite le gaspillage de l'option (b). Si le coût par appel devenait un
problème, basculer sur (c).

### Décision 2 — Observabilité Langfuse : ne pas la brancher en ligne

`LANGFUSE_PUBLIC_KEY` sert d'interrupteur (`llm.py:79`, `observability.py:77`). **Ne pas la
renseigner** : Langfuse est un service tiers hors du périmètre imposé (`CONTEXT.md` §3), et le
brief demande d'utiliser le **Log stream** de l'App Service pour le suivi (point 8). Les appels
d'observabilité deviennent alors des no-op, sans effet sur le chemin critique.

### Décision 3 — Externaliser le seuil de remboursement

Le brief cite explicitement les « seuils des garde-fous » parmi les valeurs à externaliser. Or
`REFUND_CAP = 50.0` est **en dur** (`tools/_common.py:11`). Il faut donc le lire depuis
l'environnement, avec `50` comme valeur par défaut afin de ne rien changer au comportement actuel ni
aux tests. Même traitement, plus accessoire, pour `VELMO_RECENT_MESSAGES` et `VELMO_TOKEN_BUDGET`.

## 2.4 Correspondance local vers Azure

Tableau de reprise, à utiliser au moment du déploiement. Colonne « Reporté » à cocher au fur et à
mesure dans le runbook.

| Nom dans le `.env` local              | Nom du paramètre côté Azure                 | Nature     | À renseigner                           | Reporté    |
| ------------------------------------- | ------------------------------------------- | ---------- | -------------------------------------- | ---------- |
| `AZURE_AI_INFERENCE_ENDPOINT`         | `AZURE_AI_INFERENCE_ENDPOINT`               | config     | oui                                    | non        |
| `AZURE_AI_INFERENCE_API_KEY`          | `AZURE_AI_INFERENCE_API_KEY`                | **secret** | oui                                    | non        |
| `AZURE_AI_INFERENCE_MODEL`            | `AZURE_AI_INFERENCE_MODEL`                  | config     | oui                                    | non        |
| `AZURE_JUDGE_MODEL`                   | `AZURE_JUDGE_MODEL`                         | config     | oui (décision 1a)                      | non        |
| `AZURE_JUDGE_ENDPOINT`                | —                                           | config     | non (repli sur le principal)           | sans objet |
| `AZURE_JUDGE_API_KEY`                 | —                                           | secret     | non (repli sur le principal)           | sans objet |
| `DB_URL`                              | `DB_URL`                                    | **secret** | oui                                    | non        |
| `VELMO_MEMORY_DB` (chemin de fichier) | `VELMO_MEMORY_DB_URL` (chaîne de connexion) | **secret** | oui                                    | non        |
| — (en dur `tools/_common.py:11`)      | `VELMO_REFUND_CAP`                          | config     | oui                                    | non        |
| — (en dur `memory/__init__.py:85`)    | `VELMO_RECENT_MESSAGES`                     | config     | optionnel                              | non        |
| — (défaut `memory/__init__.py:87`)    | `VELMO_TOKEN_BUDGET`                        | config     | optionnel                              | non        |
| `CHROMA_URL`                          | —                                           | config     | non (FAQ RAG hors périmètre)           | sans objet |
| `EMBEDDING_MODEL`                     | —                                           | config     | non (idem)                             | sans objet |
| `LANGFUSE_PUBLIC_KEY`                 | —                                           | secret     | non (décision 2)                       | sans objet |
| `LANGFUSE_SECRET_KEY`                 | —                                           | secret     | non (décision 2)                       | sans objet |
| `LANGFUSE_BASE_URL`                   | —                                           | config     | non (décision 2)                       | sans objet |
| `EVAL_MIN_SCORE`                      | —                                           | config     | non — **jamais lu par le code** (§2.5) | sans objet |
| `AGENT_LANGUAGE`                      | —                                           | config     | non — **jamais lu par le code** (§2.5) | sans objet |
| —                                     | `SCM_DO_BUILD_DURING_DEPLOYMENT`            | plateforme | oui                                    | non        |
| —                                     | `WEBSITES_PORT`                             | plateforme | oui                                    | non        |

## 2.5 Écarts constatés entre le `.env` local, `.env.example` et le code

Relevés lors du balayage. À corriger pour que `.env.example` redevienne une documentation fiable.

| Écart                                  | Constat                                   | Action                          |
| -------------------------------------- | ----------------------------------------- | ------------------------------- |
| 4 variables absentes de `.env.example` | présentes dans le `.env` local (a)        | ajouter, **sans valeur**        |
| `EVAL_MIN_SCORE`                       | déclarée mais **jamais lue** (b)          | retirer ou marquer inutilisée   |
| `AGENT_LANGUAGE`                       | dans le `.env` local, **jamais lue**      | retirer ou implémenter          |
| Modèle par défaut incohérent           | trois noms différents selon la source (c) | aligner sur le déploiement réel |

**(a)** `AGENT_LANGUAGE`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL`.

**(b)** Déclarée dans `.env.example:22`, mais la porte qualité prend son seuil en argument de ligne de
commande (`score.py:27`, défaut 90). Confirmé par recherche : aucune lecture dans le code.

**(c)** `.env.example:6` annonce `grok-4.3`, le code utilise `gpt-5.6-terra` (`llm.py:86`), le README
mentionne « Kimi-K2.6 ».

Ces écarts ne sont pas des failles de sécurité, mais ils faussent l'exhaustivité si l'on se fie à
`.env.example`. C'est précisément pourquoi l'inventaire a été construit à partir du code.

## 2.6 Garanties d'absence de secret dans le dépôt Git

C'est le critère d'évaluation le plus explicite du brief. Preuves relevées le 2026-07-27.

| Contrôle                               | Résultat                      | Preuve                            |
| -------------------------------------- | ----------------------------- | --------------------------------- |
| `.gitignore` couvre `.env`             | **conforme**                  | `.gitignore:24-26`                |
| `.env` n'est pas suivi par Git         | **conforme**                  | `git ls-files` (a)                |
| Aucun secret dans le code source       | **conforme, avec une nuance** | §2.1 et ci-dessous (b)            |
| Aucun secret dans l'**historique** Git | **conforme**                  | `git log -S` : aucun résultat (c) |
| Régénération d'une clé exposée         | sans objet                    | aucune exposition détectée        |
| `.env.example` documente les noms      | **à corriger**                | incomplet (§2.5)                  |
| Rien d'exposé dans les pages           | **à vérifier en ligne**       | `chat_app.py:92-97` (d)           |

**(a)** Ne renvoie que `.env.example` et `alembic/env.py`, jamais le `.env` réel.

**(b)** Toutes les valeurs sensibles passent par `os.getenv` ou `os.environ`. Deux identifiants de
développement local sont néanmoins écrits en clair dans le dépôt — détaillés juste après.

**(c)** `git log -S "AZURE_AI_INFERENCE_API_KEY="` ne renvoie rien, et aucun commit ne porte sur
`.env`.

**(d)** Point 7 du brief. Point d'attention développé plus bas : l'interface affiche de la
configuration interne, sans secret.

### Nuance : deux identifiants de développement local figurent en clair dans le dépôt

À soulever soi-même en revue de code plutôt que de le laisser trouver. Un relecteur qui cherche
un motif de chaîne de connexion (`://utilisateur:motdepasse@`) tombera sur deux occurrences :

| Occurrence                               | Contenu                                                   | Statut                  |
| ---------------------------------------- | --------------------------------------------------------- | ----------------------- |
| `docker-compose.yml`, service `postgres` | `POSTGRES_USER` et `POSTGRES_PASSWORD` à `app`            | développement local (a) |
| `db.py:168`                              | repli `postgresql+psycopg://app:app@localhost:5432/velmo` | défaut de confort (b)   |

**(a)** Identifiants du conteneur PostgreSQL de développement, lié à un volume Docker local, sans
exposition réseau au-delà de `localhost:5432`.

**(b)** Utilisé quand `DB_URL` est absente, cohérent avec le `docker-compose` ci-dessus.

Pourquoi ce n'est pas un manquement au critère du brief : ces valeurs ne donnent accès à **aucune
ressource Azure**. Elles ne désignent qu'un service local sur `localhost`, jetable, recréé par
`make up`. Le critère porte sur les secrets de production — clé du service d'IA et connexion au
stockage mémoire — qui, eux, ne figurent nulle part dans le dépôt.

Conséquence pour le déploiement, en revanche : en ligne, `DB_URL` et `VELMO_MEMORY_DB_URL`
**doivent** être renseignées dans les paramètres d'application. Si `DB_URL` manque, le code ne
lève pas d'erreur : il retombe silencieusement sur ce `localhost` et l'application démarre sans
base. Ce repli est un piège d'exploitation à contrôler au point 5 (voir `03-schema-cible.md`).

### Point d'attention : l'interface expose de la configuration

Le brief demande au point 7 de vérifier qu'« aucun secret **ni donnée de configuration** n'est
exposé dans les réponses ou les pages de l'application ». Deux éléments de l'interface sont à revoir
avant la mise en ligne :

1. **Bandeau latéral** (`chat_app.py:92-97`) : affiche le type du client LLM, le type du magasin de
   FAQ et l'état du garde-fou de 2e ligne (« actif » ou « inactif »). Aucun secret, mais ce sont
   des **données de configuration interne**.
2. **Panneau « coulisses »** (`chat_app.py:113-142`) : affiche la route empruntée et surtout la
   **catégorie de blocage** des garde-fous. Utile en démonstration, mais cela renseigne un
   utilisateur malveillant sur le fonctionnement exact des règles.

**Recommandation** : conditionner ces deux zones à un paramètre d'application `VELMO_DEBUG_PANEL`
(absent ou `false` par défaut). On garde ainsi le panneau pour la soutenance devant la CTO, tout en
pouvant démontrer que l'application n'expose rien par défaut. À trancher avec le formateur, car ces
panneaux servent aussi à **prouver** le bon fonctionnement de la mémoire et des garde-fous.

Point favorable relevé par ailleurs : en cas de panne, l'agent renvoie un message neutre
(`TECHNICAL_FALLBACK`, `agent.py:38-42`) et **n'expose jamais la cause technique** au client. La
journalisation des blocages masque déjà les catégories sensibles (`guardrails/__init__.py:170`,
`"[masqué]"` pour `pii` et `secret_leak`).

## 2.7 Points de contrôle avant soumission au formateur

| Point                                                           | Vérifié                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| L'inventaire couvre la clé **et** l'endpoint du service d'IA    | oui (§2.1 A et B)                              |
| L'inventaire couvre la connexion au stockage mémoire            | oui (`VELMO_MEMORY_DB_URL`, §2.1 A)            |
| L'inventaire couvre les seuils des garde-fous                   | oui (`VELMO_REFUND_CAP`, §2.1 B et décision 3) |
| L'inventaire est établi à partir du code, pas de `.env.example` | oui (méthode, §2.5)                            |
| Ce qui reste volontairement en dur est justifié                 | oui (§2.1 D)                                   |
| Le mécanisme de stockage côté Azure est décrit et justifié      | oui (§2.2)                                     |
| Le choix entre paramètres d'application et coffre est argumenté | oui (§2.2)                                     |
| La chaîne de lecture des valeurs à l'exécution est décrite      | oui (§2.2)                                     |
| L'absence de secret dans le dépôt et l'historique est prouvée   | oui (§2.6)                                     |
| Aucune valeur réelle ne figure dans ce document                 | oui                                            |
| Décision sur l'activation du LLM-juge                           | **à acter avec le formateur** (décision 1)     |
| Décision sur l'exposition du panneau de débogage                | **à acter avec le formateur** (§2.6)           |
| `.env.example` mis à jour et complété                           | **à faire** (§2.5)                             |
