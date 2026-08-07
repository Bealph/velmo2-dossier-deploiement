// Rend les quatre schémas mermaid en fichiers .svg autonomes et portables.
//
// Chaîne : sources .mermaid → Edge piloté par CDP → conversion des libellés
// → post-traitement (fond, dimensions) → fichiers.
//
// ---------------------------------------------------------------------------
// Pourquoi ce n'est pas un simple appel à mermaid.render
// ---------------------------------------------------------------------------
//
// mermaid produit ses libellés en <foreignObject>, c'est-à-dire du HTML posé
// dans le SVG. Cela s'affiche dans un navigateur et nulle part ailleurs :
// dans Inkscape, dans la plupart des visionneuses et dans un document qui
// importe le SVG, les libellés disparaissent — il ne reste que des boîtes
// vides. Pour des fichiers destinés à être partagés et insérés, c'est
// disqualifiant.
//
// L'option `htmlLabels: false` de mermaid est censée régler cela. Dans la
// version 11 elle donne un texte inutilisable : chaque MOT part à la ligne,
// quelle que soit la valeur de `wrappingWidth` (vérifié sur les trois formes
// de configuration). On rend donc AVEC les libellés HTML, puis on les convertit
// soi-même : on relève dans le navigateur la géométrie et le style réellement
// appliqués, et on réécrit chaque libellé en <text>/<tspan>. La mise en page
// reste celle de mermaid, le fichier devient portable.
//
// Deuxième point : le thème est sombre, donc le texte est clair. Un SVG à fond
// transparent devient illisible dès qu'il est posé sur du blanc — on peint donc
// le fond.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const FOND = "#0d1117";
const NOMS = [
  "01-flux-requete",
  "02-trajet-secrets",
  "03-trajet-journaux",
  "04-schema-complet",
];

const [, , dirSources, dirCible] = process.argv;
const ICI = resolve(".");

// Le thème vit ICI, en un seul endroit. Les sources gardent leur directive
// %%{init}%% pour rester collables telles quelles dans mermaid.live ; pour ce
// rendu on la retire et on applique la même configuration par l'API, une
// directive multiligne faisant échouer l'analyse.
const THEME = {
  theme: "base",
  themeVariables: {
    darkMode: true,
    background: FOND,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "13px",
    primaryColor: "#161b22",
    primaryTextColor: "#e6edf3",
    primaryBorderColor: "#8b949e",
    lineColor: "#8b949e",
    secondaryColor: "#161b22",
    tertiaryColor: FOND,
    clusterBkg: FOND,
    clusterBorder: "#30363d",
    edgeLabelBackground: FOND,
    titleColor: "#e6edf3",
  },
  flowchart: { curve: "basis", nodeSpacing: 45, rankSpacing: 52, padding: 12 },
};

function nettoyer(src) {
  return src
    .replace(/%%\{init:[\s\S]*?\}\}%%/g, "")
    .split("\n")
    .filter((l) => !/^\s*%%(?!\{)/.test(l))
    .join("\n")
    .trim();
}

function dimensions(svg) {
  const m = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!m) throw new Error("SVG sans viewBox : impossible de dimensionner");
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x, y, w, h };
}

const MARGE = 16; // respiration autour du dessin, et garde-fou anti-rognage

function postTraiter(svg, nom) {
  const d = dimensions(svg);

  // viewBox élargi : mermaid le calcule au plus juste sur sa propre mise en
  // page, si bien qu'un nœud posé au bord se faisait rogner. La marge évite
  // aussi qu'un schéma inséré dans un document touche son cadre.
  const x = d.x - MARGE;
  const y = d.y - MARGE;
  const w = d.w + 2 * MARGE;
  const h = d.h + 2 * MARGE;
  svg = svg.replace(
    /viewBox="[^"]*"/,
    `viewBox="${x} ${y} ${w} ${h}"`
  );

  // Dimensions explicites : une visionneuse autonome n'a aucun conteneur pour
  // déduire la taille d'un width="100%".
  //
  // Le remplacement est ANCRÉ sur la balise <svg> ouvrante. Sans cet ancrage,
  // une expression non globale retire la première occurrence trouvée dans tout
  // le document : mermaid n'émettant pas de `height` sur <svg>, c'était celui
  // du rectangle de cluster qui disparaissait — et un rect sans hauteur ne se
  // dessine pas, d'où des sous-graphes sans cadre.
  const finTete = svg.indexOf(">") + 1;
  let tete = svg.slice(0, finTete);
  const corps = svg.slice(finTete);
  tete = tete
    .replace(/max-width:\s*[^;"]+;?/, "")
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .replace("<svg ", `<svg width="${Math.round(w)}" height="${Math.round(h)}" `);
  svg = tete + corps;

  const fin = svg.indexOf(">") + 1;
  const fond = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${FOND}"/>`;
  const entete =
    `<!-- Velmo 2.0 sur Azure — ${nom}\n` +
    `     Source de vérité : dossier-deploiement/diagrammes/${nom}.mermaid\n` +
    `     Libellés convertis en <text> : aucun foreignObject, SVG portable. -->`;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    entete +
    "\n" +
    svg.slice(0, fin) +
    fond +
    svg.slice(fin)
  );
}

const defs = {};
for (const nom of NOMS) {
  defs[nom] = nettoyer(readFileSync(join(dirSources, `${nom}.mermaid`), "utf8"));
}

const navigateur = await puppeteer.connect({
  browserURL: process.env.CDP_URL || "http://127.0.0.1:9333",
});

try {
  const page = await navigateur.newPage();
  await page.setViewport({ width: 1800, height: 1400 });
  await page.setContent(
    "<!doctype html><html><body><div id='scene' style='width:1700px'></div></body></html>"
  );
  await page.addScriptTag({
    path: join(ICI, "node_modules", "mermaid", "dist", "mermaid.min.js"),
  });

  const rendus = await page.evaluate(
    async (defs, theme) => {
      const NS = "http://www.w3.org/2000/svg";

      // Découpe le contenu HTML d'un libellé en lignes visuelles : <br> et
      // éléments de bloc font rupture, le reste s'accumule.
      function lignesDe(racine) {
        const lignes = [];
        let courant = "";
        const pousser = () => {
          const t = courant.replace(/\s+/g, " ").trim();
          if (t) lignes.push(t);
          courant = "";
        };
        (function parcourir(n) {
          for (const enfant of n.childNodes) {
            if (enfant.nodeType === Node.TEXT_NODE) {
              courant += enfant.textContent;
            } else if (enfant.tagName === "BR") {
              pousser();
            } else {
              const bloc = ["P", "DIV", "LI"].includes(enfant.tagName);
              if (bloc) pousser();
              parcourir(enfant);
              if (bloc) pousser();
            }
          }
        })(racine);
        pousser();
        return lignes;
      }

      // Remplace chaque foreignObject par du <text> SVG, en conservant la
      // géométrie et le style que le navigateur a réellement appliqués.
      function convertir(svgEl) {
        let faits = 0;
        for (const fo of [...svgEl.querySelectorAll("foreignObject")]) {
          const lignes = lignesDe(fo);
          if (!lignes.length) {
            fo.remove();
            continue;
          }

          const x = parseFloat(fo.getAttribute("x")) || 0;
          const y = parseFloat(fo.getAttribute("y")) || 0;
          const w = parseFloat(fo.getAttribute("width")) || 0;
          const h = parseFloat(fo.getAttribute("height")) || 0;

          const modele = fo.querySelector("span, p, div") || fo;
          const st = getComputedStyle(modele);
          const taille = parseFloat(st.fontSize) || 13;
          // Les libellés de sous-graphe arrivent en noir depuis le HTML : sur
          // fond sombre, ils ne survivraient pas au retrait de la feuille de
          // style interne. On leur rend la couleur de texte du thème.
          const noir = /rgba?\(0,\s*0,\s*0/.test(st.color || "");
          const couleur = !st.color || noir ? "#e6edf3" : st.color;
          const famille = st.fontFamily || "monospace";
          const graisse = st.fontWeight || "normal";

          const interligne = h / lignes.length;
          const cx = x + w / 2;

          const text = document.createElementNS(NS, "text");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("font-family", famille);
          text.setAttribute("font-size", `${taille}px`);
          text.setAttribute("font-weight", graisse);
          text.setAttribute("fill", couleur);

          lignes.forEach((ligne, i) => {
            const ts = document.createElementNS(NS, "tspan");
            ts.setAttribute("x", String(cx));
            // centre vertical de la ligne, puis demi-hauteur de capitale
            ts.setAttribute(
              "y",
              String(y + interligne * i + interligne / 2 + taille * 0.34)
            );
            ts.textContent = ligne;
            text.appendChild(ts);
          });

          fo.parentNode.replaceChild(text, fo);

          // La largeur mesurée par mermaid sur le libellé HTML est parfois
          // légèrement inférieure à celle du <text> équivalent : le texte
          // débordait alors de sa boîte, et se faisait rogner par le viewBox
          // pour les nœuds situés au bord. On contraint chaque ligne trop
          // large à la largeur disponible, en resserrant l'espacement.
          if (w > 0) {
            for (const ts of text.childNodes) {
              if (ts.getComputedTextLength() > w) {
                ts.setAttribute("textLength", String(w));
                ts.setAttribute("lengthAdjust", "spacingAndGlyphs");
              }
            }
          }
          faits++;
        }
        return faits;
      }

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        ...theme,
      });

      const scene = document.getElementById("scene");
      const sortie = {};
      let n = 0;

      for (const [nom, def] of Object.entries(defs)) {
        try {
          const { svg } = await mermaid.render("g" + ++n, def);
          // le SVG doit être DANS le document : sans mise en page, pas de
          // getComputedStyle exploitable.
          const boite = document.createElement("div");
          boite.innerHTML = svg;
          scene.appendChild(boite);
          const svgEl = boite.querySelector("svg");
          const convertis = convertir(svgEl);

          // Le cadre des sous-graphes était invisible : mermaid le remplit de
          // la couleur du fond et le trace en #30363d, trop sombre. Or ce
          // cadre porte une information — ce qui tourne DANS l'App Service.
          // On le rend lisible, et on neutralise l'ombre portée et le trait
          // en dégradé du thème, qui ne survivent pas hors navigateur.
          const style = document.createElementNS(NS, "style");
          style.textContent =
            ".cluster rect{fill:#111823 !important;stroke:#4a5566 !important;" +
            "stroke-width:1px !important;filter:none !important;}";
          svgEl.appendChild(style);
          sortie[nom] = {
            ok: true,
            convertis,
            svg: new XMLSerializer().serializeToString(svgEl),
          };
        } catch (e) {
          sortie[nom] = { ok: false, erreur: String(e?.message ?? e) };
        }
      }
      return sortie;
    },
    defs,
    THEME
  );

  mkdirSync(dirCible, { recursive: true });

  for (const nom of NOMS) {
    const r = rendus[nom];
    if (!r?.ok) {
      console.log(`  ECHEC ${nom} : ${r ? r.erreur : "aucun résultat"}`);
      continue;
    }
    const svg = postTraiter(r.svg, nom);
    writeFileSync(join(dirCible, `${nom}.svg`), svg, "utf8");
    const { w, h } = dimensions(svg);
    console.log(
      `  ${(nom + ".svg").padEnd(24)} ${String(Math.round(svg.length / 1024)).padStart(3)} Ko  ` +
        `${Math.round(w)}x${Math.round(h)} px  libellés convertis=${r.convertis}  ` +
        `foreignObject=${(svg.match(/<foreignObject/g) || []).length}`
    );
  }
} finally {
  await navigateur.disconnect();
}
