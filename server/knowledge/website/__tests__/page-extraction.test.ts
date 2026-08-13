import { describe, expect, it } from "vitest";
import { extractPageContent } from "../page-extraction";

describe("extractPageContent — boilerplate stripping", () => {
  it("strips nav/header/footer/script/style content entirely", () => {
    const html = `<html><head><title>Koriaki</title></head><body>
      <header><nav>Inicio | Catálogo | Contacto</nav></header>
      <main><h1>Kit TRAVO</h1><p>Compatible con Hilux Revo desde 2016.</p></main>
      <footer>Copyright 2026 Koriaki. Todos los derechos reservados.</footer>
      <script>trackEvent('pageview')</script>
      <style>.hero { color: red; }</style>
    </body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-travo");

    expect(result.fullText).not.toContain("Copyright");
    expect(result.fullText).not.toContain("Catálogo");
    expect(result.fullText).not.toContain("trackEvent");
    expect(result.fullText).toContain("Compatible con Hilux Revo desde 2016");
  });
});

describe("extractPageContent — section splitting", () => {
  it("splits into one section per heading, grouping paragraphs after it", () => {
    const html = `<html><body><main>
      <h2>Kit TRAVO</h2>
      <p>Compatible con Hilux Revo desde 2016.</p>
      <h2>Envíos</h2>
      <p>Para provincia enviamos por Shalom.</p>
    </main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({ heading: "Kit TRAVO", text: "Compatible con Hilux Revo desde 2016." });
    expect(result.sections[1]).toMatchObject({ heading: "Envíos", text: "Para provincia enviamos por Shalom." });
  });

  it("captures a heading-less leading section", () => {
    const html = `<html><body><main><p>Bienvenido a Koriaki.</p><h2>Servicios</h2><p>Instalación disponible.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");

    expect(result.sections[0]).toMatchObject({ heading: null, text: "Bienvenido a Koriaki." });
  });
});

describe("extractPageContent — context classification", () => {
  it("classifies a compatibility section as PRODUCT via keyword match", () => {
    const html = `<html><body><main><h2>Kit</h2><p>El TRAVO es compatible con Hilux Revo desde 2016.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    expect(result.sections[0].context).toBe("PRODUCT");
  });

  it("classifies a shipping section as SERVICE", () => {
    const html = `<html><body><main><h2>Envíos</h2><p>Para provincia enviamos por Shalom.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/servicios");
    expect(result.sections[0].context).toBe("SERVICE");
  });

  it("classifies a testimonial blockquote as TESTIMONIAL even on a PRODUCT-path URL", () => {
    const html = `<html><body><main>
      <h2>Kit TRAVO</h2><p>Compatible con Hilux Revo desde 2016.</p>
      <h3>Testimonio de cliente</h3><blockquote>Llegó en un día, excelente servicio.</blockquote>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-travo");

    const testimonialSection = result.sections.find((s) => s.text.includes("Llegó en un día"));
    expect(testimonialSection?.context).toBe("TESTIMONIAL");
    // The PRODUCT section on the same page/URL is unaffected.
    expect(result.sections[0].context).toBe("PRODUCT");
  });

  it("classifies marketing superlatives as MARKETING", () => {
    const html = `<html><body><main><h1>Bienvenido</h1><p>¡Somos líderes en kits para tu camioneta, la mejor calidad garantizada!</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");
    expect(result.sections[0].context).toBe("MARKETING");
  });

  it("falls back to the URL path hint when no section keyword matches", () => {
    const html = `<html><body><main><h2>Info</h2><p>Contenido genérico sin palabras clave particulares aquí.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/politica-de-garantia");
    expect(result.sections[0].context).toBe("POLICY");
  });

  it("falls back to UNKNOWN when neither section keywords nor URL hints match", () => {
    const html = `<html><body><main><h2>Info</h2><p>Contenido genérico sin palabras clave particulares aquí.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/misc-page-xyz");
    expect(result.sections[0].context).toBe("UNKNOWN");
  });

  it("(regression) recognizes a testimonial heading beyond the literal word 'testimonio' — 'Lo que dicen nuestros clientes'", () => {
    const html = `<html><body><main>
      <h2>Kit TRAVO</h2><p>Compatible con Hilux Revo desde 2016.</p>
      <h2>Lo que dicen nuestros clientes</h2>
      <p>Compré el kit y me confirmaron la compatibilidad con mi Hilux 2022 antes de comprar.</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-travo");

    const reviewSection = result.sections.find((s) => s.text.includes("Compré el kit"));
    expect(reviewSection?.context).toBe("TESTIMONIAL");
  });

  it("(regression) recognizes a pull-quote wrapped in typographic quote marks as TESTIMONIAL even under a generic heading", () => {
    const html = `<html><body><main>
      <h2>Nuestra comunidad</h2>
      <p>“Compré el kit de conversión GR Sport para mi Hilux y el ajuste fue exacto, la compatibilidad fue confirmada.”</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");

    expect(result.sections[0].context).toBe("TESTIMONIAL");
  });

  it("(regression) classifies a rhetorical-question CTA heading as MARKETING, not PRODUCT, even though the body mentions vehicle brands", () => {
    const html = `<html><body><main>
      <h2>¿Buscas piezas para tu Toyota o Ford?</h2>
      <p>Escríbenos para consultar disponibilidad, compatibilidad con tu modelo y obtener una cotización personalizada.</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");

    expect(result.sections[0].context).toBe("MARKETING");
  });

  it("(regression) a genuine FAQ-headed question is still classified FAQ, not swept into MARKETING by the rhetorical-question rule", () => {
    const html = `<html><body><main>
      <h2>Preguntas frecuentes</h2>
      <p>¿Cuál es el tiempo de garantía?</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");

    expect(result.sections[0].context).toBe("FAQ");
  });

  it("computes a dominant page-wide context by majority vote, ignoring UNKNOWN", () => {
    const html = `<html><body><main>
      <h2>A</h2><p>El TRAVO es compatible con Hilux Revo.</p>
      <h2>B</h2><p>El TRAVO también sirve para Fortuner compatible.</p>
      <h2>C</h2><p>Testimonio de cliente satisfecho.</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    expect(result.dominantContext).toBe("PRODUCT");
  });
});

describe("extractPageContent — links and title", () => {
  it("extracts the page title", () => {
    const html = `<html><head><title>Koriaki - Tienda</title></head><body><main><p>x</p></main></body></html>`;
    expect(extractPageContent(html, "https://koriakiimport.com/tienda").title).toBe("Koriaki - Tienda");
  });

  it("collects every href found on the page", () => {
    const html = `<html><body><main><a href="/tienda">Tienda</a><a href="https://external.com">Externo</a></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");
    expect(result.links).toEqual(["/tienda", "https://external.com"]);
  });
});

// Realistic shape, matching the real koriakiimport.com /tienda markup
// (verified against the live site): a page-wide H1 with no per-product
// heading structure, and one <article> product card per product — image
// link, a title link, a short description <p>, and a compatibility badge
// <span>. This is the exact pattern that used to become one giant
// multi-product blob under the single H1 before the tiered segmentation fix.
function productCard(title: string, description: string, compatBadge: string): string {
  return `<article>
    <a href="/tienda/x"><img alt="${title}" /></a>
    <div><a href="/tienda/x">${title}</a><p>${description}</p></div>
    <div><span>${compatBadge}</span></div>
  </article>`;
}

describe("extractPageContent — CARD tier (product cards)", () => {
  it("a multi-product catalog page produces one separate section per product, not one giant blob", () => {
    const html = `<html><body><main>
      <h1>Catálogo</h1>
      <p>41 productos disponibles.</p>
      ${productCard("Kit Conversión Hilux → GR Sport", "Kit completo de carrocería que transforma tu Hilux al estilo GR Sport.", "Compatible con Hilux")}
      ${productCard("Faros LED Fortuner", "Faros LED completos para Fortuner con DRL secuencial.", "Compatible con Fortuner")}
      ${productCard("Parrilla Ranger Raptor", "Parrilla OEM style para Ranger Raptor con acabado negro texturizado.", "Compatible con Ranger")}
    </main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const cardSections = result.sections.filter((s) => s.tier === "CARD");

    expect(cardSections).toHaveLength(3);
    expect(cardSections.every((s) => s.reliable)).toBe(true);
    expect(cardSections.map((s) => s.subjectHint)).toEqual([
      "Kit Conversión Hilux → GR Sport",
      "Faros LED Fortuner",
      "Parrilla Ranger Raptor",
    ]);
  });

  it("one product's compatibility statement never drags a neighboring product's text into its own evidence", () => {
    const html = `<html><body><main>
      <h1>Catálogo</h1>
      ${productCard("Kit Hilux", "Compatible con Hilux Revo desde 2016.", "Hilux")}
      ${productCard("Kit Fortuner", "Compatible con Fortuner Legender desde 2020.", "Fortuner")}
    </main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const hiluxSection = result.sections.find((s) => s.text.includes("Hilux Revo"));
    const fortunerSection = result.sections.find((s) => s.text.includes("Fortuner Legender"));

    expect(hiluxSection).toBeDefined();
    expect(fortunerSection).toBeDefined();
    expect(hiluxSection).not.toBe(fortunerSection);
    expect(hiluxSection?.text).not.toContain("Fortuner");
    expect(fortunerSection?.text).not.toContain("Hilux");
  });

  it("a card's own title is not duplicated as a separate PARAGRAPH-tier section after removal", () => {
    const html = `<html><body><main>
      <h1>Catálogo</h1>
      ${productCard("Kit Hilux", "Compatible con Hilux Revo desde 2016.", "Hilux")}
    </main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const nonCardSections = result.sections.filter((s) => s.tier !== "CARD");

    expect(nonCardSections.some((s) => s.text.includes("Compatible con Hilux Revo"))).toBe(false);
  });
});

describe("extractPageContent — structural subject priority (Sprint 8 quality-fix review, item 2 follow-up)", () => {
  it("(regression) a generic section label ('Descripción') never becomes the subject — the page's H1 wins instead", () => {
    const html = `<html><body><main>
      <h1>Faros LED Hilux Revo</h1>
      <h2>Descripción</h2>
      <p>Compatible con Hilux Revo 2016–2024.</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/faros-led-hilux-revo");

    const section = result.sections.find((s) => s.text.includes("Compatible con Hilux"));
    expect(section?.subjectHint).toBe("Faros LED Hilux Revo");
  });

  it("(regression) other generic UI labels (Características, Detalles, Información, Especificaciones) are also overridden by the page H1", () => {
    for (const label of ["Características", "Detalles", "Información", "Especificaciones", "Más información"]) {
      const html = `<html><body><main><h1>Kit Hilux GR Sport</h1><h2>${label}</h2><p>Compatible con Hilux.</p></main></body></html>`;
      const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-hilux-gr-sport");
      const section = result.sections.find((s) => s.text.includes("Compatible con Hilux"));
      expect(section?.subjectHint).toBe("Kit Hilux GR Sport");
    }
  });

  it("falls back to the page <title> when there is no H1 at all", () => {
    const html = `<html><head><title>Faros LED Prado — Koriaki</title></head><body><main><h2>Descripción</h2><p>Compatible con Prado.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/faros-led-prado");
    const section = result.sections.find((s) => s.text.includes("Compatible con Prado"));
    expect(section?.subjectHint).toBe("Faros LED Prado — Koriaki");
  });

  it("falls back to a humanized URL slug when neither H1 nor <title> exist", () => {
    const html = `<html><body><main><h2>Descripción</h2><p>Compatible con Ranger.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/parrilla-ranger-raptor");
    const section = result.sections.find((s) => s.text.includes("Compatible con Ranger"));
    expect(section?.subjectHint).toBe("Parrilla Ranger Raptor");
  });

  it("a genuinely specific, non-generic local heading is still available as a last-resort subject when no H1/title/slug exists", () => {
    const html = `<html><body><main><h2>Kit Especial Edición Limitada</h2><p>x</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");
    expect(result.sections[0].subjectHint).toBe("Kit Especial Edición Limitada");
  });

  it("a product card's own title still wins over the page H1 on a multi-product listing page", () => {
    const html = `<html><body><main>
      <h1>Tienda</h1>
      <article><h3>Faros LED Fortuner</h3><p>Compatible con Fortuner.</p></article>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const cardSection = result.sections.find((s) => s.tier === "CARD");
    expect(cardSection?.subjectHint).toBe("Faros LED Fortuner");
  });
});

describe("extractPageContent — weakly structured fallback", () => {
  it("a huge unstructured block under one heading falls back to bounded, explicitly unreliable chunks — never one giant reliable candidate", () => {
    // Simulates a page with no <article> cards and no sub-headings — one
    // long run of unrelated sentences under a single H1, the shape that
    // used to become one 2000+ character "reliable" blob.
    const sentences = Array.from(
      { length: 20 },
      (_, i) => `Producto número ${i} es compatible con Hilux y tiene garantía de fábrica de doce meses completos.`,
    );
    const html = `<html><body><main><h1>Catálogo</h1><p>${sentences.join(" ")}</p></main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");

    expect(result.sections.length).toBeGreaterThan(1); // split into multiple chunks, not one blob
    for (const section of result.sections) {
      expect(section.text.length).toBeLessThanOrEqual(500);
      expect(section.tier).toBe("FALLBACK");
      expect(section.reliable).toBe(false); // never treated as safely groundable
    }
  });

  it("two short unrelated paragraphs under one heading merge into a single small, still-reliable HEADING section", () => {
    const html = `<html><body><main><h1>Info</h1><p>Compatible con Hilux Revo desde 2016.</p><p>Envíos a nivel nacional por Shalom.</p></main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].tier).toBe("HEADING");
    expect(result.sections[0].reliable).toBe(true);
  });

  it("(regression) two adjacent elements with no literal whitespace between them in the markup get a space inserted between their text", () => {
    // The exact real-world shape that produced "Aros y RinesDESTACADO":
    // a heading immediately followed by a badge <span>, no space in the
    // source HTML between them.
    const html = `<html><body><main><article><h3>Aros y Rines<span class="badge">DESTACADO</span></h3><p>Compatible con Hilux.</p></article></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const cardSection = result.sections.find((s) => s.tier === "CARD");
    expect(cardSection?.subjectHint).toBe("Aros y Rines DESTACADO");
  });

  it("(regression) does not insert a space where the source markup already had one — no double-spacing", () => {
    const html = `<html><body><main><article><h3>Aros y Rines <span class="badge">DESTACADO</span></h3><p>x</p></article></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    const cardSection = result.sections.find((s) => s.tier === "CARD");
    expect(cardSection?.subjectHint).toBe("Aros y Rines DESTACADO");
  });

  it("several paragraphs whose combined text exceeds the reliable-section cap split into individually reliable PARAGRAPH-tier sections", () => {
    const paragraphs = [
      "Compatible con Hilux Revo desde 2016, instalación incluida en el precio del kit completo de conversión.",
      "Compatible con Fortuner Legender desde 2020, ajuste OEM verificado por nuestro equipo técnico especializado.",
      "Compatible con Ranger Raptor desde 2019, incluye todos los soportes y pernos necesarios para instalación.",
      "Envíos a nivel nacional por Shalom, con seguimiento incluido y tiempo estimado de tres a cinco días hábiles.",
      "Envío gratis en compras mayores a quinientos soles dentro del área metropolitana de Lima y Callao.",
      "Garantía de doce meses en todos nuestros productos importados directamente desde el fabricante original.",
    ];
    const html = `<html><body><main><h1>Info</h1>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");

    expect(paragraphs.join(" ").length).toBeGreaterThan(500); // sanity-check the fixture actually exceeds the cap
    expect(result.sections).toHaveLength(paragraphs.length);
    expect(result.sections.every((s) => s.tier === "PARAGRAPH")).toBe(true);
    expect(result.sections.every((s) => s.reliable)).toBe(true);
  });
});
