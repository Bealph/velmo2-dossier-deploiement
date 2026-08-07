# Régénérer les fichiers `.svg` des schémas

Les `.svg` de `diagrammes/svg/` sont **produits**, pas écrits à la main. La source de vérité reste
les quatre fichiers `.mermaid` du dossier parent. Après toute modification d'un schéma, relancer la
génération, sinon les `.svg` mentent.

## Prérequis

| Élément                                    | Pourquoi                                          |
| ------------------------------------------ | ------------------------------------------------- |
| Node.js 20 ou plus                         | exécuter le script                                |
| `npm install mermaid@11 puppeteer-core`    | le moteur de rendu et le pilotage du navigateur   |
| Microsoft Edge (déjà présent sous Windows) | mermaid a besoin d'un vrai moteur de mise en page |

Aucun navigateur n'est téléchargé : on pilote l'Edge du système.

## Marche à suivre

Le `msedge.exe` de Windows est un **lanceur** : il délègue à un processus détaché puis rend la main.
Un outil qui tente de le démarrer croit donc à un échec immédiat. On démarre donc Edge à part, avec
un port de débogage, puis le script s'y connecte.

```powershell
# 1. Edge sans affichage, avec port de débogage et profil dédié
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  -ArgumentList "--headless=new","--disable-gpu","--no-sandbox",
                "--remote-debugging-port=9333","--user-data-dir=$env:TEMP\edge-svg","about:blank"

# 2. Génération (depuis le dossier contenant node_modules)
node build-svg.mjs "..\..\diagrammes" "..\..\diagrammes\svg"

# 3. Fermer l'instance
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like "*remote-debugging-port=9333*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Le script attend le port `9333`, ou la valeur de la variable d'environnement `CDP_URL`.

## Ce que le script fait, et pourquoi

| Traitement                                                                  | Raison                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retire la directive `%%{init}%%` des sources et applique le thème par l'API | une directive multiligne fait échouer l'analyse ; le thème vit alors en un seul endroit                                                                                       |
| Convertit chaque `<foreignObject>` en `<text>`/`<tspan>`                    | mermaid produit ses libellés en HTML : ils ne s'affichent que dans un navigateur et disparaissent dans Inkscape, dans les visionneuses et dans un document qui importe le SVG |
| Contraint par `textLength` les lignes plus larges que leur boîte            | la largeur mesurée par mermaid sur le libellé HTML est parfois inférieure à celle du `<text>` équivalent, et le texte débordait                                               |
| Élargit le `viewBox` de 16 px                                               | mermaid le calcule au plus juste : un nœud posé au bord se faisait rogner                                                                                                     |
| Peint un rectangle de fond                                                  | le thème est sombre, donc le texte est clair : sans fond, le schéma devient illisible sur du blanc                                                                            |
| Rend visible le cadre des sous-graphes                                      | mermaid le remplit de la couleur du fond et le trace en `#30363d`, invisible — alors que ce cadre porte une information : ce qui tourne **dans** l'App Service                |

**Piège à connaître.** `htmlLabels: false`, l'option prévue par mermaid pour obtenir du texte SVG,
est inutilisable en version 11 : chaque **mot** part à la ligne, quelle que soit la valeur de
`wrappingWidth`. D'où la conversion manuelle.
