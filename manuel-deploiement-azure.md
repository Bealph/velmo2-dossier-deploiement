# Manuel — déployer une application Python sur Azure App Service, de bout en bout

Ce manuel explique **ce qui se passe réellement** quand on déploie, puis donne les deux chemins
possibles, appliqués à Velmo 2.0. Il n'est pas une liste de clics : une procédure qu'on suit sans
comprendre ne se dépanne pas, et le premier déploiement rate toujours quelque part.

Toutes les affirmations sur le comportement d'Azure viennent de la documentation Microsoft, citée en
fin de document. Les affirmations sur le code de Velmo renvoient à `fichier:ligne` du dépôt
[velmo-v2](https://github.com/Bealph/velmo-v2).

---

## 1. Le modèle mental : deux moments, deux conteneurs

C'est le point qu'il faut tenir avant tout le reste. **Déployer, c'est deux choses distinctes.**

| Moment    | Ce qui se passe                                            | Où                                  |
| --------- | ---------------------------------------------------------- | ----------------------------------- |
| **Build** | installer les dépendances, préparer les fichiers           | un conteneur de build, jeté ensuite |
| **Run**   | démarrer le processus qui écoute le port et sert les pages | le conteneur d'exécution            |

Ces deux conteneurs **ne sont pas le même**. La documentation le dit explicitement : « le conteneur
de build dans lequel Oryx s'exécute est différent du conteneur d'exécution dans lequel l'application
tourne ». D'où une règle qui évite des heures de dépannage :

> **Ne jamais coder en dur un chemin absolu du type `/home/site/wwwroot` dans les scripts de build.**
> Toujours des chemins relatifs à la racine du projet.

La deuxième idée à tenir : **App Service ne « lance » pas votre application au hasard.** Il applique
une cascade de règles pour trouver quoi démarrer. Si vous ne lui dites rien, il devine — et pour une
application Streamlit, il devine mal. C'est la cause n°1 du fameux « je vois la page par défaut
d'Azure au lieu de mon application ».

---

## 2. Les briques Azure, dans l'ordre où on les crée

| Ordre | Ressource               | Rôle                                                 |
| ----- | ----------------------- | ---------------------------------------------------- |
| 1     | Groupe de ressources    | le tiroir : tout dedans, supprimable d'un seul geste |
| 2     | Plan App Service        | la machine louée : cœurs, RAM, disque, prix          |
| 3     | App Service (Web App)   | l'application posée sur ce plan                      |
| 4     | Base de données managée | l'état durable, hors de l'application                |
| 5     | Service d'IA            | le modèle appelé par l'application                   |

Le **plan** et l'**application** sont deux objets différents : un plan peut porter plusieurs
applications, et c'est le plan qui coûte, pas l'application.

---

## 3. Chemin A — le déploiement « clique-bouton » (code source)

C'est celui que la ressource formateur recommande, et celui retenu pour Velmo. On pousse du **code**,
Azure se charge de construire.

### 3.1 Ce qu'Azure regarde dans votre dépôt

Le moteur de build s'appelle **Oryx**. Il inspecte la **racine du projet** et applique la première
règle qui correspond :

| Fichier trouvé à la racine        | Ce qu'Oryx fait                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `requirements.txt`                | `pip install -r requirements.txt`                                                  |
| `pyproject.toml` **et** `uv.lock` | utilise **uv**                                                                     |
| `pyproject.toml` et `poetry.lock` | utilise poetry                                                                     |
| `pyproject.toml` seul             | utilise poetry                                                                     |
| `setup.py`                        | `pip install .`                                                                    |
| aucun des précédents              | erreur : « Could not find setup.py or requirements.txt; Not running pip install. » |

**Pour Velmo, c'est une bonne nouvelle** : le dépôt a `pyproject.toml` **et** `uv.lock`, donc Oryx
utilise `uv`, exactement le gestionnaire du projet. Aucun `requirements.txt` à fabriquer, aucune
divergence de versions à craindre.

> **Piège documenté** : si `pyproject.toml` est présent mais que `uv.lock` **manque**, Azure bascule
> sur Poetry — même sans `poetry.lock`. Il faut donc que `uv.lock` soit réellement déployé, pas
> ignoré par un `.gitignore`.

Le fichier de dépendances doit être **à la racine du projet déployé**. S'il est dans un
sous-dossier, rien ne s'installe.

### 3.2 Le réglage qui déclenche le build

```
SCM_DO_BUILD_DURING_DEPLOYMENT = 1
```

Sans lui, Azure copie vos fichiers sans rien installer, et l'application tombe au démarrage sur un
`ModuleNotFoundError`.

**Corollaire important** : ne **jamais** déployer votre environnement virtuel local (`.venv`). Un
environnement virtuel n'est pas portable — il contient des chemins absolus de votre machine. On
laisse Oryx en créer un sur place.

### 3.3 Ce qu'Oryx exécute, dans l'ordre

1. `PRE_BUILD_COMMAND`, si défini ;
2. l'installation des dépendances (tableau du §3.1) ;
3. `manage.py collectstatic` si c'est du Django ;
4. `POST_BUILD_COMMAND`, si défini.

`POST_BUILD_COMMAND` est l'endroit naturel pour **les migrations de base de données** — pour Velmo,
`alembic upgrade head`.

### 3.4 Où atterrit le code — le détail qui surprend

> Quand une application Python est déployée **avec build automatique**, le contenu est déployé et
> servi depuis `/tmp/<uid>`, **et non** sous `/home/site/wwwroot`. On y accède par la variable
> d'environnement `APP_PATH`.

Deux conséquences pratiques :

- chercher son code dans `/home/site/wwwroot` en SSH et ne rien y trouver n'est **pas** un bug ;
- **tout fichier écrit à l'exécution à côté du code est perdu** au redémarrage. Il faut écrire sous
  `/home`, ou dans un stockage externe. C'est une raison de plus, indépendante de la concurrence, de
  sortir la mémoire de Velmo du système de fichiers.

### 3.5 Le démarrage : la cascade

Au démarrage, le conteneur applique, **dans cet ordre** :

1. la **commande de démarrage personnalisée**, si elle existe ;
2. sinon, détection d'une application Django (`wsgi.py`) → Gunicorn ;
3. sinon, détection d'une application Flask (`application.py` ou `app.py`) → Gunicorn ;
4. sinon, **l'application par défaut d'Azure** — la page « votre application est en ligne » que
   personne ne veut voir.

Par défaut, Azure lance Gunicorn avec `--bind=0.0.0.0 --timeout 600`, derrière un proxy Nginx.

**Velmo n'est ni Django ni Flask** : c'est Streamlit, qui n'est pas un serveur WSGI. Sans commande de
démarrage, on tombe donc forcément sur le cas 4. La commande est obligatoire, pas optionnelle.

### 3.6 La commande de démarrage pour Velmo

Dans le portail : **Configuration** → **Paramètres généraux** → **Commande de démarrage**.

```bash
python -m streamlit run scripts/chat_app.py \
  --server.port $PORT \
  --server.address 0.0.0.0 \
  --server.headless true \
  --server.enableWebsocketCompression false
```

Chaque option a une raison :

| Option                                      | Pourquoi                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `python -m streamlit`                       | contourne un `streamlit.exe` parfois bloqué ; c'est déjà ce que fait le `Makefile` du projet         |
| `--server.port $PORT`                       | pour un conteneur **intégré**, la doc dit d'utiliser la variable `PORT` ; la valeur usuelle est 8000 |
| `--server.address 0.0.0.0`                  | écouter sur toutes les interfaces, sinon le proxy ne joint pas le processus                          |
| `--server.headless true`                    | ne pas tenter d'ouvrir un navigateur, ni demander un e-mail au premier lancement                     |
| `--server.enableWebsocketCompression false` | contournement documenté des soucis de WebSocket derrière le proxy                                    |

> **Correction importante par rapport au dossier de conception.** La documentation est formelle :
> « Web Sockets are supported on Linux apps. The `webSocketsEnabled` ARM doesn't apply to Linux apps
> since Web Sockets are always enabled for Linux. » **Il n'y a donc rien à activer** : l'interrupteur
> « Web sockets » du portail concerne les applications Windows. Le dossier demandait de l'activer,
> c'est une étape inutile — à corriger.

### 3.7 Les paramètres d'application

**Configuration** → **Paramètres d'application**. Ils arrivent au processus comme de simples
variables d'environnement, donc `os.getenv` les lit sans qu'une ligne de code change.

```python
db_server = os.environ["DATABASE_SERVER"]   # exactement le même code qu'en local
```

Deux règles : seuls lettres, chiffres et `_` sont acceptés dans les noms ; **enregistrer redémarre
l'application**.

### 3.8 Brancher le dépôt GitHub — et le choix qui compte

**Centre de déploiement** → **Paramètres** → **Source** → **GitHub**.

Azure propose alors deux moteurs de construction, et **le choix par défaut n'est pas neutre** :

| Fournisseur                   | Comment ça marche                                                                                            | Ce que ça implique                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **GitHub Actions** (défaut)   | Azure **écrit un fichier de workflow dans votre dépôt** ; la construction se fait chez GitHub                | authentification par **identité managée affectée par l'utilisateur** (OpenID Connect), ou par profil de publication |
| **App Service Build Service** | Azure pose un **webhook** sur le dépôt ; à chaque push il récupère le code et construit lui-même (Kudu/Oryx) | exige l'**authentification de base SCM**                                                                            |

**Pour Velmo, c'est « App Service Build Service » qu'il faut choisir**, en cliquant sur **Changer de
fournisseur**. Raison de périmètre, pas de goût : le dossier de conception exclut explicitement
l'identité managée et RBAC, non cités par le brief. Or l'option par défaut en crée une. Rester sur le
moteur natif garde le déploiement dans le périmètre autorisé, et c'est aussi le « clique-bouton » au
sens strict — rien à écrire, pas de fichier de workflow ajouté au dépôt.

### 3.9 Vérifier, dans cet ordre

| Quoi                                 | Où                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| la construction a réussi             | **Centre de déploiement** → **Journaux** → commit → **Show Logs** en face de « Running oryx build » |
| l'application a démarré              | **Surveillance** → **Log stream**                                                                   |
| ce qui existe vraiment sur le disque | SSH : `az webapp ssh --name <app> --resource-group <rg>`                                            |

En ligne de commande :

```bash
az webapp log config --name <app> --resource-group <rg> --docker-container-logging filesystem
az webapp log tail   --name <app> --resource-group <rg>
```

### 3.10 Les quatre pannes classiques, et leur cause

| Symptôme                                        | Cause réelle                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| la page par défaut d'Azure s'affiche            | aucune commande de démarrage, et l'application n'est ni Django ni Flask → cas 4 de la cascade |
| `ModuleNotFoundError` au démarrage              | `SCM_DO_BUILD_DURING_DEPLOYMENT` absent, ou `.venv` local déployé                             |
| « Could not find setup.py or requirements.txt » | le fichier de dépendances n'est pas à la racine du projet                                     |
| « Service Unavailable »                         | Gunicorn a démarré mais l'application non : erreur dans le code, ou mauvais port              |

---

## 4. Chemin B — le déploiement d'une image conteneur

Ici on ne pousse plus du code mais une **image** déjà construite. Azure ne construit rien : il tire
l'image et la lance.

### 4.1 Quand ce chemin s'impose

- une dépendance système non-Python (bibliothèque native, binaire, police, moteur) ;
- une version de langage non proposée par les piles intégrées ;
- un environnement qu'on veut **identique** en local et en ligne.

Pour Velmo, aucun de ces cas ne se présente dans le cœur : les dépendances sont pures Python. Le seul
argument serait la FAQ sémantique (Chroma + PyTorch, ~2,5 Go), écartée du périmètre en ligne.

### 4.2 Le Dockerfile de production qu'il faudrait écrire

Celui du dépôt **n'est pas réutilisable** : il lance le REPL en ligne de commande et n'expose aucun
port (`Dockerfile:16`), et il ne copie pas `kb/` — la FAQ y serait donc vide. Un Dockerfile de
production ressemblerait à ceci :

```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 1. Les dépendances d'abord, le code ensuite : cette couche est mise en cache
#    et n'est reconstruite que si les dépendances changent.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --extra llm --extra demo

# 2. Le code applicatif ET les fichiers dont il a besoin à l'exécution.
#    kb/ est indispensable : LocalKB résout kb/docs relativement à la racine
#    du dépôt (kb_store.py:15). Sans lui, la FAQ est vide en silence.
COPY src   ./src
COPY kb    ./kb
COPY scripts ./scripts
COPY alembic alembic.ini version.yaml ./

# 3. Le port doit être déclaré ET réellement écouté.
EXPOSE 8000

CMD ["uv", "run", "python", "-m", "streamlit", "run", "scripts/chat_app.py", \
     "--server.port", "8000", "--server.address", "0.0.0.0", "--server.headless", "true"]
```

Les trois commentaires numérotés sont les trois erreurs les plus fréquentes : copier le code avant
les dépendances (et perdre le cache), oublier les fichiers de données, et exposer un port sans
l'écouter.

### 4.3 Construire l'image **sans Docker sur son poste**

`az acr build` envoie le contexte au registre, qui construit à distance :

```bash
az acr create --resource-group rg-velmo-prod --name crvelmoprod --sku Basic
az acr build  --registry crvelmoprod --image velmo:v1 .
```

C'est aussi ce qui rend ce chemin plus lourd : **le registre est une ressource de plus**, donc une
ligne de facture de plus.

### 4.4 Brancher l'App Service sur l'image

```bash
az webapp config container set \
  --name app-velmo-prod --resource-group rg-velmo-prod \
  --container-image-name crvelmoprod.azurecr.io/velmo:v1 \
  --docker-registry-server-url https://crvelmoprod.azurecr.io \
  --docker-registry-server-user <utilisateur> \
  --docker-registry-server-password <motdepasse>
```

Ces identifiants sont stockés dans `DOCKER_REGISTRY_SERVER_URL`, `DOCKER_REGISTRY_SERVER_USERNAME` et
`DOCKER_REGISTRY_SERVER_PASSWORD`. Ce sont des noms **réservés** : l'application ne peut pas les lire,
par sécurité.

L'alternative sans mot de passe est l'identité managée avec le rôle `AcrPull` — **configurable par
CLI uniquement, pas par le portail** — mais elle sort du périmètre du brief.

### 4.5 Le port, en conteneur personnalisé

La règle change complètement par rapport au chemin A :

> App Service n'a aucun contrôle sur le port écouté par votre conteneur. S'il écoute sur **80 ou
> 8080**, la détection est automatique. Sinon, il faut renseigner `WEBSITES_PORT`.

```bash
az webapp config appsettings set -g rg-velmo-prod -n app-velmo-prod --settings WEBSITES_PORT=8000
```

Deux précisions qui font perdre du temps si on les ignore : **un seul port** peut être exposé, et
`WEBSITES_PORT` **n'existe pas comme variable d'environnement à l'intérieur du conteneur**.

### 4.6 Le démarrage, et le test de vie

Azure envoie une requête HTTP sur `/robots933456.txt`. Ce chemin n'existe pas : **c'est voulu**.
L'application doit simplement répondre *quelque chose* — un 404 fait l'affaire et signale « je suis
vivant ». Si elle ne répond rien, Azure conclut à un échec et **redémarre le conteneur en boucle**.

Le délai est de 240 secondes par défaut, réglable jusqu'à 1800 :

```
WEBSITES_CONTAINER_START_TIME_LIMIT = 600
```

### 4.7 Le disque, en conteneur

Par défaut sur Linux, `/home` **n'est ni partagé entre instances ni conservé au redémarrage**. Pour
l'activer :

```
WEBSITES_ENABLE_APP_SERVICE_STORAGE = true
```

Attention au piège inverse : écrire beaucoup de données **hors** de `/home` consomme l'espace disque
de l'hôte, limité à 15 Go par instance, et finit en échec de démarrage.

---

## 5. Les deux chemins côte à côte

| Critère                     | A — code source                   | B — image conteneur                |
| --------------------------- | --------------------------------- | ---------------------------------- |
| Ressources à créer          | 1 (l'application)                 | 2 (application + registre)         |
| Qui construit               | Azure (Oryx)                      | vous, ou le registre               |
| Fichier à écrire            | aucun                             | un `Dockerfile` de production      |
| Port                        | variable `PORT`                   | `WEBSITES_PORT`, sauf 80/8080      |
| Boucle de correction        | commit → push → Azure reconstruit | build → push image → redéploiement |
| Maîtrise de l'environnement | celle qu'Azure propose            | totale                             |
| Dépendances système         | impossible                        | possible                           |

---

## 6. Le cas Velmo : ce qu'il faut changer avant de déployer

Par ordre de gravité. Les deux premiers sont bloquants.

| #   | Changement                                                                                                           | Pourquoi                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `memory_session_factory` doit accepter une **URL de connexion** au lieu de `sqlite:///` (`memory/models.py:127-145`) | sans lui, R2 est indémontrable — et voir §7                                             |
| 2   | Émettre les blocages de garde-fous sur `stdout`                                                                      | le Log stream ne montre que `stdout` et `stderr` ; sans cela, rien à prouver au point 7 |
| 3   | Commande de démarrage Streamlit                                                                                      | sans elle, c'est la page par défaut d'Azure (cascade, §3.5)                             |
| 4   | Externaliser `REFUND_CAP` (`tools/_common.py:11`)                                                                    | le brief demande les seuils de garde-fous hors du code                                  |
| 5   | Vérifier que `kb/docs/` arrive jusqu'au runtime                                                                      | sinon la FAQ est vide **sans aucune erreur**                                            |

---

## 7. Ce que cette lecture apporte au dossier

Trois éléments concrets, à reporter dans le dossier de conception.

**La documentation Microsoft écarte SQLite elle-même.** Le choix de PostgreSQL n'était appuyé que sur
un raisonnement de concurrence. Il l'est désormais par la plateforme :

> « Le système de fichiers de votre application est un partage réseau monté. [...] Cela empêche
> l'usage de bases de données fichier comme SQLite, car il n'est pas possible d'acquérir des verrous
> exclusifs sur le fichier de base. Nous recommandons un service de base managé comme [...] Azure
> Database for PostgreSQL. »

C'est la meilleure réponse possible à l'objection « pourquoi ne pas simplement déposer le fichier
SQLite dans un stockage ? » : ce n'est pas une préférence d'architecte, c'est une contre-indication
documentée du fournisseur.

**L'activation des Web sockets est une étape inutile.** Elle est toujours active sur Linux. À retirer
du dossier et du runbook, sinon c'est une case à cocher qui n'existe pas et qui fera perdre du temps
le jour du déploiement.

**Le Centre de déploiement crée une identité managée par défaut.** Le dossier place explicitement
l'identité managée hors périmètre. Il faut donc **changer de fournisseur** vers « App Service Build
Service » — un point à signaler au formateur, puisqu'il touche au périmètre qu'il doit valider.

---

## Sources

Documentation Microsoft consultée le 2026-08-07. Le dépôt
[MicrosoftDocs/azure-docs](https://github.com/MicrosoftDocs/azure-docs) est la source de ces pages.

- [Configure a Linux Python app for Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-python) — Oryx, `SCM_DO_BUILD_DURING_DEPLOYMENT`, cascade de démarrage, `/tmp/<uid>`, journaux
- [Configure a custom container](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container?pivots=container-linux) — `WEBSITES_PORT`, identifiants de registre, `WEBSITES_ENABLE_APP_SERVICE_STORAGE`, `robots933456`
- [Continuous deployment to Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-continuous-deployment) — Centre de déploiement, GitHub Actions et App Service Build Service
- [Azure App Service on Linux FAQ](https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/faqs-app-service-linux-new) — Web sockets sur Linux, variable `PORT`, SQLite, délai de démarrage
- [Deploy Streamlit on Azure Web App](https://techcommunity.microsoft.com/blog/appsonazureblog/deploy-streamlit-on-azure-web-app/4276108) — commande de démarrage Streamlit
