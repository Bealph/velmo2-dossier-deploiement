# 1. Choix des services Azure

> Attendu du brief : sélectionner et justifier les services Azure adaptés à l'hébergement de l'agent,
> de sa mémoire persistante et de son service d'IA.
> Périmètre : uniquement les services cités dans le brief et la ressource formateur. Voir `CONTEXT.md` §3.

Toutes les affirmations sur le code renvoient à `fichier:ligne` du dépôt
`TP7_Reconstruire-agent-de-zero_(memoire, garde-fous et MLOps)/velmo-v2` (lecture seule).
Les caractéristiques techniques Azure citées proviennent de la page tarifaire officielle
App Service for Linux (consultée le 2026-07-27). **Les montants ne sont pas repris de mémoire** :
voir §1.5 pour la procédure de relevé des prix réels.

---

## 1.1 Hébergement de l'agent

### Ce que le code impose

| Contrainte constatée                     | Référence                            | Conséquence                             |
| ---------------------------------------- | ------------------------------------ | --------------------------------------- |
| Python 3.11 strict                       | `pyproject.toml:5`                   | pile Python 3.11 native (a)             |
| Interface web = Streamlit                | `scripts/chat_app.py`, `Makefile:35` | port HTTP + **WebSockets** (b)          |
| **Aucune** dépendance système non-Python | `pyproject.toml:6-12`                | rien n'oblige au conteneur (c)          |
| Extra `vector` = PyTorch ~2,5 Go         | `pyproject.toml:16-19`               | **seul** argument pour le conteneur (d) |
| Le `Dockerfile` du dépôt lance le CLI    | `Dockerfile:16`                      | non réutilisable en production (e)      |

**(a)** Contrainte `>=3.11,<3.12`, satisfaite par la pile d'exécution « Python 3.11 » d'App Service.

**(b)** Streamlit s'appuie sur Tornado, donc sur des WebSockets. **Rien n'est à activer** :
« les WebSockets sont pris en charge sur les applications Linux ; la propriété ARM `webSocketsEnabled`
ne s'applique pas aux applications Linux, les WebSockets y étant toujours actifs »
([FAQ App Service sur Linux](https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/faqs-app-service-linux-new)).
L'interrupteur « Web sockets » visible dans le portail ne concerne que les applications Windows.
Une version antérieure de ce dossier demandait de l'activer : c'était une étape inexistante,
corrigée le 2026-08-07.

**(c)** Le cœur ne dépend que de pydantic, dotenv, SQLAlchemy, psycopg et Alembic.

**(d)** chromadb et sentence-transformers, plus un serveur Chroma séparé
(`docker-compose.yml:36-45`), volontairement exclus de l'installation courante (`Makefile:5-6`).

**(e)** Il lance le CLI, pas Streamlit, et n'expose aucun port : un `Dockerfile` de production serait
entièrement à écrire.

Point décisif : les trois exigences non négociables (mémoire, garde-fous, qualité mesurée) ne
dépendent **pas** de l'extra `vector`. La mémoire est relationnelle (`CONTEXT.md` §5.3), les
garde-fous sont des règles regex en code (`guardrails/__init__.py`), la qualité est une suite de
tests. L'extra `vector` ne sert qu'à la **FAQ RAG** (`kb_store.py`), qui est un confort fonctionnel.

### Comparaison sur les trois critères imposés

| Critère     | App Service (Linux, B1)            | Conteneur (Container Apps)       |
| ----------- | ---------------------------------- | -------------------------------- |
| Facilité    | 1 ressource, aucune image à écrire | 2 ressources, image à construire |
| Coût        | fixe et prévisible                 | à la consommation, + registre    |
| Adéquation  | couvre tout le périmètre évalué    | seul à garder la FAQ sémantique  |
| **Verdict** | **retenu**                         | utile plus tard                  |

#### Critère « facilité »

**App Service** — une seule ressource à provisionner, plus son plan. Déploiement direct depuis GitHub
via le Centre de déploiement, sans écrire d'image : la pile Python 3.11 est native et Azure installe
les dépendances à partir du dépôt. C'est la voie **explicitement recommandée** par la ressource
formateur (« Idéal — recommandé ici »), qui classe le conteneur en « utile plus tard ».

**Container Apps** — deux ressources au minimum : l'application **et** un registre d'images. Impose
d'écrire un `Dockerfile` de production — celui du dépôt lance le CLI sans exposer de port
(`Dockerfile:16`) — de construire puis pousser l'image, et de la reconstruire à chaque modification.
Chaîne plus longue, donc plus de points de panne pour un premier déploiement.

#### Critère « coût »

**App Service, plan Basic B1** — 1 cœur, 1,75 Go de RAM, 10 Go de stockage. Coût fixe et prévisible,
un seul poste de facturation. F1 (gratuit) est écarté : plan partagé, 60 min de CPU par jour, 1 Go de
RAM, **sans SLA**, et Microsoft indique que l'usage en production n'y est **pas pris en charge** —
sans compter le démarrage à froid, inacceptable pendant la démonstration à la CTO.

**Container Apps** — facturation à la consommation, en principe plus fine. Mais le registre d'images
s'ajoute au coût, et conserver la FAQ sémantique suppose de dimensionner pour PyTorch (~2,5 Go) plus
un service Chroma. Total **supérieur** et moins prévisible qu'un B1 fixe.

#### Critère « adéquation à Velmo 2.0 »

**App Service** — couvre tout le périmètre évalué : Streamlit (WebSockets toujours actifs sur Linux), Python
3.11, connexion à Postgres managé, secrets en paramètres d'application, journaux via **Log stream**.
Le seul manque est la recherche **sémantique** de la FAQ : 1,75 Go de RAM et 10 Go de disque rendent
PyTorch et Chroma inadaptés. La FAQ elle-même reste servie par le repli lexical `LocalKB`, sans
dépendance supplémentaire (voir la conséquence ci-dessous).

**Container Apps** — seule option capable de conserver la recherche sémantique en ligne. Cet avantage
porte sur une fonctionnalité **hors des trois exigences** du brief, au prix d'une complexité et d'un
coût supérieurs.

### Décision retenue

**Azure App Service (Linux), plan Basic B1.**
La **FAQ RAG (Chroma et embeddings) est volontairement mise hors périmètre de la version en ligne.**

### Justification

1. **Aucune contrainte technique ne force le conteneur.** Le cœur de Velmo 2.0 n'a aucune dépendance
   système non-Python (`pyproject.toml:6-12`). Le conteneur ne se justifierait que pour l'extra
   `vector`, exclu du périmètre en ligne.
2. **Aucune des trois exigences évaluées n'est dégradée.** Mémoire (relationnelle vers Postgres
   managé, §1.2), garde-fous (regex en code, inchangés), qualité mesurée (suite de tests, inchangée).
   Ce qui est noté au brief reste intégralement couvert.
3. **Critère « facilité » décisif à ce stade.** Une ressource au lieu de deux, pas d'image à
   construire, et la voie recommandée par la ressource formateur, qui classe le conteneur en
   « utile plus tard ».
4. **Coût maîtrisé et prévisible**, cohérent avec un crédit étudiant limité (`CONTEXT.md` §4).
5. **B1 plutôt que F1** : F1 est sans SLA, plafonné à 60 min de CPU/jour et non pris en charge en
   production ; B1 apporte **Always On**, donc pas de démarrage à froid pendant la soutenance.

**Conséquence assumée et documentée** — formulation corrigée après relecture du code le 2026-08-07.

Ce qui est mis hors périmètre, c'est la recherche **sémantique**, pas la FAQ. Le code prévoit un
repli explicite : `get_kb()` renvoie `LocalKB` dès que `CHROMA_URL` est absente
(`kb_store.py:107-118`), et `LocalKB` est une recherche lexicale pondérée par la rareté des termes
(IDF léger) sur les fichiers `kb/docs/*.md`, **sans aucune dépendance hors bibliothèque standard**
(`kb_store.py:34-58`). Les seize fiches de la FAQ continuent donc d'être servies et citées.

Ce qui est réellement perdu : la tolérance aux **paraphrases et aux synonymes**. `LocalKB` apparie
des tokens ; une question qui ne partage aucun terme avec la fiche ne la trouvera pas, là où les
embeddings l'auraient rapprochée. Le filet de sécurité reste en place dans les deux cas : sans
extrait, le prompt système impose de **dire que l'information manque et de proposer une escalade**
plutôt que d'inventer (`agent.py:19-29`), et le repli conversationnel « llm + rag »
(`agent.py:223-240`) injecte les extraits trouvés pour ancrer la réponse.

**Condition de déploiement qui en découle, à ne pas manquer.** `LocalKB` localise ses fiches par
`Path(__file__).resolve().parents[2] / "kb" / "docs"` (`kb_store.py:15`) : un chemin relatif à
**l'arborescence du dépôt**, pas au paquet installé. Or `pyproject.toml:50-51` ne publie que
`packages = ["src/velmo"]`, et le `Dockerfile` du dépôt copie `pyproject.toml`, `src` et `eval` —
**jamais `kb`**. Si le répertoire n'arrive pas jusqu'au runtime, `_load_docs` ne lève rien
(`is_dir()` est faux, la liste reste vide) et l'agent répond « Je n'ai pas trouvé cette information
dans notre FAQ. » (`agent.py:314-315`) : une FAQ silencieusement vide, sans le moindre message
d'erreur. Le déploiement App Service doit donc **inclure `kb/docs/` et exécuter l'application depuis
l'arborescence du dépôt**. À contrôler au point 5, par une question FAQ posée en ligne.

Réintroduire la recherche sémantique serait l'évolution naturelle, via conteneur, dans un second
temps.

## 1.2 Stockage persistant de la mémoire long terme

### Nature réelle du besoin (prérequis levé)

La question ouverte de `CONTEXT.md` §5.3 est tranchée par le code : **la mémoire long terme ne fait
aucune recherche sémantique.** Les faits durables sont extraits par **règles regex**
(`memory/__init__.py:63-70`) et stockés dans une table relationnelle `faits_semantiques`
(`memory/models.py:37`). La recherche épisodique vectorielle est conçue mais **non implémentée**
(`read` renvoie `episodic=[]`, `memory/__init__.py:187`).

Le besoin est donc **strictement relationnel**. Aucun service vectoriel n'est nécessaire.

Aujourd'hui, ces deux tables vivent dans un **fichier SQLite** `data/velmo_memory.sqlite`
(`memory/models.py:142`), précisément le fichier local que le brief demande de remplacer.

### Comparaison des candidats

Candidats retenus dans le périmètre « base de données / stockage managé Azure ». Synthèse d'abord,
argumentaire par candidat ensuite.

| Candidat                           | R2 persistance  | R3 isolation | Coût           | Effort    | Verdict    |
| ---------------------------------- | --------------- | ------------ | -------------- | --------- | ---------- |
| PostgreSQL Flexible Server (B1ms)  | oui             | oui          | faible         | minimal   | **retenu** |
| Azure SQL Database (Basic)         | oui             | oui          | comparable     | supérieur | écarté     |
| Compte de stockage — Blob          | fichier durable | non natif    | le plus faible | inadapté  | écarté     |
| Compte de stockage — Table Storage | oui             | native       | très faible    | élevé     | écarté     |

#### PostgreSQL Flexible Server, Burstable B1ms — retenu

**R2** : base managée, stockage durable indépendant de l'App Service, sauvegardes automatiques. La
mémoire survit au redémarrage, au redéploiement et au changement de poste.

**R3** : l'invariant `filter_by(user_id=...)` du code est conservé tel quel et s'exécute en
`WHERE user_id = ...`. L'index `ix_faits_user_type` (`models.py:45`) devient un index Postgres.

**Effort** : minimal, et c'est l'argument décisif. `psycopg` est déjà une dépendance du cœur
(`pyproject.toml:10`), `db.py:168` attend déjà une URL Postgres, Alembic est en place. Seule
modification : faire accepter une URL de connexion à `memory_session_factory`
(`models.py:127-145`), aujourd'hui figée sur `sqlite:///`.

#### Azure SQL Database, Basic — écarté

Répond à R2 et à R3 de façon équivalente, pour un coût comparable. Mais dialecte et pilote
différents : il faudrait ajouter un pilote ODBC ou `pyodbc`, puis revalider le schéma SQLAlchemy et
les migrations Alembic. **Un effort supérieur sans aucun gain en échange.**

#### Compte de stockage — Blob — écarté

Déposer le fichier `.sqlite` dans un Blob **déplace le problème au lieu de le résoudre**. Un fichier
ne supporte pas les écritures concurrentes de plusieurs sessions, et il faudrait le télécharger puis
le réenvoyer à chaque tour. R3 resterait entièrement portée par le code, sans appui du service.
Contraire à l'esprit de R2, qui demande une mémoire réellement partagée.

**Microsoft écarte d'ailleurs SQLite elle-même sur App Service**, et pour une raison qui vaut aussi
pour le disque de l'application, pas seulement pour le Blob :

> « Le système de fichiers de votre application est un partage réseau monté. Cela permet les
> scénarios de montée en charge où votre code s'exécute sur plusieurs hôtes. Malheureusement, cela
> empêche l'usage de fournisseurs de bases de données fichier comme SQLite, puisqu'il n'est pas
> possible d'acquérir des verrous exclusifs sur le fichier de base. Nous recommandons un service de
> base de données managé comme Azure SQL, Azure Database for MySQL ou **Azure Database for
> PostgreSQL**. »
>
> — [FAQ App Service sur Linux](https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/faqs-app-service-linux-new), consultée le 2026-08-07

Ce n'est donc pas une préférence d'architecte : c'est une **contre-indication documentée du
fournisseur**, qui nomme précisément le service retenu ici. Le point est décisif face à l'objection
« pourquoi ne pas simplement déposer le fichier SQLite quelque part dans le cloud ? ».

#### Compte de stockage — Table Storage — écarté

C'est le candidat le moins cher, et son isolation serait même native (`PartitionKey = user_id`). Mais
le modèle NoSQL clé-valeur imposerait de **réécrire toute la couche mémoire** : abandon de
SQLAlchemy, des index, des migrations et de la logique d'upsert D18 (`memory/__init__.py:100-138`).
Risque élevé de casser R3 et l'upsert au passage — exactement ce que le brief interdit.

### Décision retenue

**Azure Database for PostgreSQL — Flexible Server, niveau Burstable B1ms**, un serveur unique
hébergeant **deux bases** : `velmo` (données métier : catalogue, clients, commandes) et
`velmo_memory` (mémoire : `faits_semantiques` et `messages`).

### Justification

1. **Le code le parle déjà.** `psycopg` est dans les dépendances du cœur, `db.py:168` attend une URL
   Postgres, Alembic est configuré. Le risque de régression est le plus faible de tous les candidats,
   ce qui est déterminant puisque le brief interdit de dégrader la mémoire au passage en ligne.
2. **Une seule ligne de conception à changer.** Seul `memory_session_factory` doit accepter une URL
   de connexion au lieu d'un chemin de fichier. La logique d'upsert, l'oubli R5 et le filtrage R3 ne
   sont pas touchés.
3. **R2 réellement satisfait.** Le stockage est **externe** à l'App Service : redémarrer, redéployer
   ou changer de poste ne perd rien, et deux vendeurs sur deux machines voient la même mémoire.
4. **Un seul serveur pour les deux bases** : la base métier est de toute façon nécessaire en ligne
   (le catalogue et les commandes viennent de Postgres, `scripts/seed.py`). Mutualiser évite un
   second poste de facturation, tout en gardant les deux bases séparées comme en local. La mémoire
   conserve ainsi son cycle de vie propre (`memory/models.py:6-8`).
5. **Séparation nette maintenue** entre données métier et mémoire, conformément à l'intention
   d'origine du code.

### Plan de la mémoire persistante (livrable explicite du brief)

**Schéma des données stocké en ligne** : deux tables, reprises à l'identique de `memory/models.py`.

Table `faits_semantiques` (mémoire long terme, faits durables du client) :

| Colonne                    | Type                  | Rôle                                                                                         |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `id`                       | entier, clé primaire  | identifiant technique                                                                        |
| `user_id`                  | texte, non nul        | **clé d'isolation (R3)**                                                                     |
| `type`                     | texte, non nul        | nature du fait (`pointure`, `adresse`, `commande`, `litige_authenticite`) ; axe d'oubli (R5) |
| `value`                    | texte, non nul        | valeur retenue (R2/R6)                                                                       |
| `statut`                   | texte, défaut `actif` | cycle de vie (`ouvert` ou `resolu` pour un litige)                                           |
| `source`                   | texte                 | `client` (prioritaire) ou `agent`                                                            |
| `confidence`               | texte                 | `eleve` (règle) ou `moyen` (LLM)                                                             |
| `created_at`, `updated_at` | horodatages           | `updated_at` arbitre les contradictions (règle D18)                                          |

Index `ix_faits_user_type` sur `(user_id, type)`, non unique : les types multi-valeur
(`commande`, `produit`) ont plusieurs lignes pour un même couple.

Table `messages` (fil de conversation) : `id`, `user_id`, `session_id`, `turn_index`, `role`,
`content`, `created_at`. Index `ix_messages_user_session` sur `(user_id, session_id)`.

**Clé d'isolation et emplacement du filtrage dans le code.** R3 est un **invariant applicatif**,
pas une propriété du service. Chaque accès est filtré par `user_id` :

| Opération               | Emplacement                                   | Filtre                                   |
| ----------------------- | --------------------------------------------- | ---------------------------------------- |
| Lecture des faits       | `memory/__init__.py:160-163` (`_facts_dict`)  | `filter_by(user_id=user_id)`             |
| Lecture de l'historique | `memory/__init__.py:181` (`read`)             | `filter_by(user_id=..., session_id=...)` |
| Écriture d'un fait      | `memory/__init__.py:104-107` (`_upsert_fact`) | `filter_by(user_id=..., type=...)`       |
| Oubli (R5)              | `memory/__init__.py:222-227` (`forget`)       | `filter_by(user_id=..., type=...)`       |
| Inspection (R6)         | `memory/__init__.py:245-246` (`inspect`)      | via `_facts_dict`                        |
| Actions métier          | `tools/_common.py` (`owned_order`)            | commande rattachée au client             |

Le passage de SQLite à Postgres **ne modifie aucun de ces filtres** : SQLAlchemy les traduit en
clauses `WHERE`. Le test d'acceptance devra malgré tout le prouver en ligne (point 6 du brief) :
un fait écrit par l'utilisateur A ne doit jamais apparaître pour l'utilisateur B.

**Répartition entre fil de conversation et faits durables**

- *Fil de conversation* : table `messages`, portée `(user_id, session_id)`, fenêtre de 60 messages
  soit 30 tours (`RECENT_MESSAGES`, `memory/__init__.py:85`). Un nouveau `session_id` est tiré à
  chaque instanciation de `MemoryManager` (`memory/__init__.py:95`) : c'est ce qui distingue deux
  sessions.
- *Faits durables* : table `faits_semantiques`, portée `user_id` **seul**, donc **indépendante de la
  session**. C'est précisément ce qui produit R2 : un fait donné en session 1 est relu en session 2,
  puisque la lecture ne filtre que sur `user_id`.

**Migration des données locales : repartir vide en ligne.** Le contenu de
`data/velmo_memory.sqlite` est un jeu de test local, sans valeur métier ; le fichier est d'ailleurs
exclu du dépôt (`.gitignore:48`). En revanche, la **base métier doit être peuplée** en ligne via
`scripts/seed.py`, sans quoi aucun outil de commande ne fonctionnera. Les tables mémoire sont créées
automatiquement au démarrage (`MemoryBase.metadata.create_all`, `memory/models.py:143`).

## 1.3 Service d'IA

- **Service retenu : Azure AI Foundry (Azure OpenAI)**, avec un modèle déployé dans la ressource.
- **Justification** : le code y est **déjà adapté**. `llm.py:84` instancie
  `OpenAI(base_url=endpoint, api_key=...)` sur un endpoint **OpenAI-compatible finissant par
  `/openai/v1`**, ce que fournit précisément Azure AI Foundry (`.env.example:1-3`). Aucun changement
  de client, aucune réécriture d'appel : seuls l'endpoint, la clé et le nom de déploiement changent,
  et ils sont déjà lus depuis l'environnement.
- **Modèle déployé** : à fixer au provisionnement. Le dépôt est **incohérent** sur ce point
  (`grok-4.3` dans `.env.example:6`, défaut `gpt-5.6-terra` dans `llm.py:86`, « Kimi-K2.6 » dans le
  README, `gpt-5.4-mini` pour le juge). Retenir **un modèle effectivement déployé dans la ressource**
  et reporter son nom exact dans `AZURE_AI_INFERENCE_MODEL`. C'est de la configuration, pas un secret.
- **Nom du déploiement** : à relever dans le portail au moment du déploiement du modèle et à
  consigner dans le runbook. C'est ce nom, et non le nom commercial du modèle, que le code envoie
  en paramètre `model` (`llm.py:46`).
- **LLM-juge (2e ligne des garde-fous)** : **désactivé par défaut** (`version.yaml:26`,
  `moderator: false`). La 1re ligne regex, elle, est toujours active et suffit aux tests
  d'acceptance du point 7. Activer le juge en ligne supposerait un second déploiement de modèle,
  donc un coût par appel supplémentaire. **Décision : ne pas l'activer**, et le documenter comme
  extension possible.
- **Région** : voir §1.4. La disponibilité du modèle choisi dans la région retenue est à **vérifier
  avant provisionnement** : c'est le point de blocage classique.

## 1.4 Région

**France Central** est retenue par défaut : recommandée par la ressource formateur, cohérente avec
une clientèle française, et proche des utilisateurs (deux vendeurs de Velmo).

**Réserve à lever avant provisionnement** : l'offre de modèles Azure OpenAI varie selon la région.
Si le modèle retenu n'est pas disponible en France Central, deux options, par ordre de préférence :

1. Choisir un autre modèle disponible en France Central (le code est agnostique : seul le nom du
   déploiement change).
2. Basculer l'ensemble sur **Sweden Central**, la seconde région autorisée par le brief.

Ne pas éclater les ressources entre deux régions sans nécessité : cela complique le suivi des coûts
et ajoute de la latence entre l'App Service et la base.

## 1.5 Récapitulatif des ressources à provisionner

Groupe de ressources **unique** : `rg-velmo-prod`, région **France Central** (sous réserve §1.4).

| Ressource            | Type Azure                                    | Nom réel              | Niveau / plan                             | Coût mensuel      |
| -------------------- | --------------------------------------------- | --------------------- | ----------------------------------------- | ----------------- |
| Groupe de ressources | Resource group                                | `adialloRG` (partagé) | sans objet                                | 0                 |
| Plan d'hébergement   | App Service plan (Linux)                      | `Alpha-velmo2`        | **Basic B1** (1 cœur, 1,75 Go RAM, 10 Go) | **11,31 €**       |
| Application          | App Service (Web App, Python 3.11)            | `Velmo2-alpha`        | porté par le plan                         | inclus            |
| Stockage mémoire     | Azure Database for PostgreSQL Flexible Server | `psql-velmo-prod-417` | **Burstable B1ms**, 32 Go                 | **11,90 €**       |
| — son stockage       | Premium SSD, 32 Go provisionnés               | —                     | 0,1142 €/Go/mois                          | **3,65 €**        |
| Service d'IA         | Azure AI Foundry (`AIServices`, S0)           | `oai-velmo-prod`      | GlobalStandard, à la consommation         | jetons, ci-dessous |
| Coffre de secrets    | Key Vault (préexistant)                       | `alpha-velmo-kv`      | 0,0258 €/10 000 opérations                | < 0,01 €          |
|                      |                                               |                       | **Total fixe**                            | **26,87 €/mois**  |

**Jetons du modèle `gpt-5.6-terra`**, GlobalStandard, contexte court, par million de jetons :
**1,7173 €** en entrée, **10,3040 €** en sortie, **0,1717 €** pour une entrée servie par le cache.
Un tour de conversation de l'agent pèse quelques milliers de jetons : à l'échelle d'une
démonstration, la dépense de jetons reste très inférieure au socle fixe.

**Le coût réel sera plus bas que 26,87 €** : les ressources ne vivront pas un mois entier, et le
groupe est supprimé — ici, ressource par ressource — en fin de brief.

Convention de nommage : `rg-` groupe de ressources, `asp-` plan App Service, `app-` application,
`psql-` base PostgreSQL, `oai-` service d'IA. Le nom de l'application doit être **globalement
unique** : il devient l'URL `https://<nom>.azurewebsites.net`.

### Procédure de relevé des coûts — **exécutée le 2026-09-08**

Les montants ci-dessus ne sont pas reportés de mémoire. Ils viennent de l'**API tarifaire publique
de Microsoft** (`prices.azure.com/api/retail/prices`), interrogée en EUR pour la région
`francecentral`, ce qui est plus reproductible que le calculateur : la requête est citable et
rejouable à l'identique, alors qu'une page web recalculée ne l'est pas.

```bash
curl "https://prices.azure.com/api/retail/prices?currencyCode=EUR&\$filter=armRegionName%20eq%20'francecentral'%20and%20serviceName%20eq%20'Azure%20App%20Service'"
```

Les tarifs horaires sont convertis en mensuel sur **730 heures**. Les jetons du modèle relèvent du
service `Foundry Models`, dont les libellés sont abrégés — `Inp` pour l'entrée, `Opt` pour la
sortie, `Std Gl` pour GlobalStandard, `ShortCo` pour le contexte court.

**Deux réserves à énoncer plutôt qu'à taire.** Ce sont des **prix catalogue** : le tarif réellement
facturé dépend de l'offre attachée à l'abonnement. Et l'abonnement utilisé n'est pas un compte
« Azure for Students » comme le supposait `CONTEXT.md` §4, mais un abonnement de formation
mutualisé — la contrainte des 100 $ de crédit ne s'applique donc pas telle quelle. Seul
**Cost Management** dira la dépense réelle, une fois les ressources en service.

**Procédure alternative** (calculateur, à privilégier si l'on veut le tarif de l'offre du compte) :

1. Ouvrir le **calculateur de prix Azure** (`azure.microsoft.com/pricing/calculator`), **connecté au
   compte** pour obtenir le tarif réellement applicable.
2. Ajouter les trois postes : App Service (Linux, B1, France Central), Azure Database for PostgreSQL
   Flexible Server (Burstable B1ms, stockage minimal), Azure OpenAI (modèle retenu).
3. Sélectionner la devise **EUR** et l'affichage **mensuel**.
4. Reporter les montants dans le tableau ci-dessus, avec la date du relevé.
5. Après provisionnement, contrôler la consommation réelle dans **Cost Management** à chaque session.

Faits tarifaires vérifiés sur la page officielle (2026-07-27), utiles à la justification :

- **F1 (gratuit)** : ressources partagées, **60 minutes de CPU par jour**, 1 Go de RAM, 1 Go de
  stockage, **aucun SLA**, et Microsoft indique que **l'usage en production n'est pas pris en
  charge**. C'est ce qui écarte F1, au-delà du seul démarrage à froid.
- **B1** : 1 cœur, **1,75 Go de RAM**, 10 Go de stockage. Ces 1,75 Go confirment au passage
  l'inadéquation de PyTorch (~2,5 Go) sur ce plan, donc la mise hors périmètre de la FAQ RAG.
- **HTTPS sur `azurewebsites.net`** : inclus **sans frais** (SSL SNI gratuit). Aucun certificat à
  acheter pour la démonstration.
- **Une application arrêtée reste facturée** : la FAQ tarifaire est explicite. Cela confirme la règle
  de `CONTEXT.md` §4. En fin de brief, **supprimer le groupe de ressources**, ne pas se contenter
  d'arrêter les services.

## 1.6 Points de contrôle avant soumission au formateur

| Point                                                                                  | Vérifié                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Les deux options d'hébergement sont comparées sur facilité, coût, adéquation           | oui                                              |
| Le choix d'hébergement s'appuie sur des faits du code, pas sur une préférence générale | oui (`pyproject.toml`, `Dockerfile`, `Makefile`) |
| La nature de la mémoire long terme est tranchée (relationnelle, sans embeddings)       | oui (`memory/__init__.py`, `memory/models.py`)   |
| Le stockage mémoire répond explicitement à R2 et à R3                                  | oui (§1.2)                                       |
| Le plan de la mémoire persistante est fourni (schéma, clé d'isolation, migration)      | oui (§1.2)                                       |
| Aucun service hors périmètre n'est introduit (`CONTEXT.md` §3)                         | oui                                              |
| Les coûts sont relevés à une source officielle, non estimés de mémoire                 | oui — API tarifaire Microsoft, 2026-09-08 (§1.5) |
| La disponibilité du modèle dans la région est vérifiée                                 | oui — `gpt-5.6-terra` en GlobalStandard à France Central, et **déployé** (§1.4) |
