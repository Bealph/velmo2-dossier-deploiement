# Velmo 2.0 sur Azure — dossier de déploiement

Mise en production de **Velmo 2.0**, l'agent de support client de Velmo (boutique de maillots de
football collector), sur Azure.

L'agent tenait ses trois promesses — mémoire, garde-fous, qualité mesurée — mais **uniquement en
local**, et sa mémoire long terme vivait dans un fichier, donc perdue au changement de machine. Deux
vendeurs, deux mémoires différentes. Ce dépôt contient la conception du déploiement qui règle cela
sans rien dégrader au passage.

- Code de l'agent : [Bealph/velmo-v2](https://github.com/Bealph/velmo-v2)
- Conception de l'agent (mémoire, garde-fous, MLOps) : [Bealph/velmo2-dossier-conception](https://github.com/Bealph/velmo2-dossier-conception)

## État

**Dossier validé, adaptations de code en attente de fusion, aucune ressource Azure provisionnée.**
La validation par le formateur — porte d'entrée du brief — est acquise. Les six adaptations que le
déploiement suppose sont écrites et testées dans
[velmo-v2#7](https://github.com/Bealph/velmo-v2/pull/7), à fusionner avant de provisionner.

## Les quatre exigences non négociables

| Réf | Exigence                                       | Comment elle est prouvée                                    |
| --- | ---------------------------------------------- | ----------------------------------------------------------- |
| R2  | Mémoire long terme persistante inter-session   | Un fait donné en session 1 est retrouvé en session 2        |
| R3  | Isolation stricte par utilisateur              | Un second utilisateur n'a pas accès aux faits du premier    |
| G   | Garde-fous entrée et sortie effectifs en ligne | Injection de prompt rejouée : blocage **et** journalisation |
| S   | Aucun secret dans le code source               | Rien dans ce dépôt, tout en paramètres d'application Azure  |

## Architecture retenue

Trois ressources dans un groupe unique, qu'on peut supprimer d'un seul geste en fin de brief.

| Rôle               | Service                                       | Niveau                     |
| ------------------ | --------------------------------------------- | -------------------------- |
| Héberger et parler | Azure App Service (Linux)                     | Basic B1                   |
| Se souvenir        | Azure Database for PostgreSQL Flexible Server | Burstable B1ms, deux bases |
| Réfléchir          | Azure AI Foundry                              | endpoint `/openai/v1`      |
| Porter les secrets | Coffre de clés `alpha-velmo-kv`               | référencé, identité managée |
| Observer           | Log stream de l'App Service                   | —                          |

Le déploiement **ne change que les substrats**, pas la logique : fichier local vers base managée,
fournisseur de modèle vers Azure AI Foundry. La chaîne de traitement reste celle du code, dans le
même ordre — garde-fou d'entrée, lecture mémoire, modèle, garde-fou de sortie, écriture mémoire.

## Comment lire ce dossier

Dans cet ordre : chaque document suppose le précédent.

| Document                                                               | Ce qu'il tranche                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [CONTEXT.md](CONTEXT.md)                                               | l'état réel du code source, références `fichier:ligne` à l'appui |
| [01-choix-services.md](dossier-deploiement/01-choix-services.md)       | App Service ou conteneur, et quel stockage pour la mémoire       |
| [02-secrets-et-config.md](dossier-deploiement/02-secrets-et-config.md) | ce qui sort du code, et où cela va côté Azure                    |
| [03-schema-cible.md](dossier-deploiement/03-schema-cible.md)           | le schéma cible, le trajet des secrets, celui des journaux       |

`CONTEXT.md` n'est pas une introduction : c'est l'**inventaire vérifié du code existant**, et tout
le dossier s'appuie dessus. Aucune affirmation sur l'application n'y figure sans référence.

## Les schémas

Quatre vues, une par question, plus une vue complète en annexe.

| Vue | Question                                         |
| --- | ------------------------------------------------ |
| 1   | Que traverse un message, et dans quel ordre ?    |
| 2   | D'où viennent les secrets, où vont-ils ?         |
| 3   | Qu'écrit-on dans les journaux, et où le lit-on ? |
| 4   | Les trois flux réunis (preuve du groupe unique)  |

```text
dossier-deploiement/diagrammes/
  *.mermaid      sources — font référence, c'est ce qu'on modifie
  svg/           images vectorielles, à insérer dans un document
  outils/        régénération des .svg depuis les sources
```

Les `.svg` sont **produits**, jamais écrits à la main. Après modification d'un schéma, régénérer :
voir [`diagrammes/outils/README.md`](dossier-deploiement/diagrammes/outils/README.md). Sinon les
images mentent.

## Ce que ce dépôt ne contient pas, et pourquoi

**Aucun secret, aucune valeur réelle.** Ni clé, ni chaîne de connexion, ni endpoint. Les documents
n'emploient que des noms de paramètres et des marqueurs `<A_RENSEIGNER_DANS_APP_SETTINGS>`. C'est un
critère d'évaluation du brief, et une règle de travail du projet — pas une précaution ajoutée après
coup.

Deux fichiers de travail restent hors dépôt : la trame de soutenance, brouillon à réviser sur
constats réels, et les questions au formateur, qui relèvent d'un échange et non d'un livrable.
