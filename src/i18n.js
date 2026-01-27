const translations = {
  de: {
    app: {
      title: "FloorPlanner – Phase 3 (Tiles + Muster)",
      subtitle: "SVG-Vorschau • Drag&Drop Ausschlüsse • Tiles: Grid + Running Bond",
      autosave: "Autosave: AN"
    },
    session: {
      title: "Session",
      reset: "Reset",
      restore: "Letzten Stand wiederherstellen",
      status: "Session:",
      lastSaved: "Zuletzt gespeichert:",
      present: "vorhanden"
    },
    project: {
      title: "Projekt (lokal)",
      namePlaceholder: "z.B. Bad EG",
      nameLabel: "Name (für Speichern)",
      save: "Projekt speichern",
      savedProjects: "Gespeicherte Projekte",
      load: "Projekt laden (ersetzt State)",
      delete: "Projekt löschen",
      saved: "Projekt gespeichert",
      loaded: "Projekt geladen",
      deleted: "Projekt gelöscht",
      notFound: "Projekt nicht gefunden.",
      none: "– keine –"
    },
    structure: {
      title: "Struktur",
      floor: "Etage",
      room: "Raum",
      addFloor: "Etage hinzufügen",
      deleteFloor: "Etage löschen",
      floorName: "Etagenname",
      addRoom: "Raum hinzufügen",
      deleteRoom: "Raum löschen",
      floorAdded: "Etage hinzugefügt",
      floorDeleted: "Etage gelöscht",
      floorChanged: "Etage geändert",
      roomAdded: "Raum hinzugefügt",
      roomDeleted: "Raum gelöscht"
    },
    room: {
      title: "Raum Details",
      sectionDisplay: "Anzeige",
      name: "Raumname",
      width: "Breite (cm)",
      height: "Länge (cm)",
      showGrid: "Hilfsraster anzeigen",
      changed: "Raum geändert",
      viewChanged: "Ansicht geändert",
      legacyHint: "Legacy: Einzelnes Rechteck. Nutzen Sie Abschnitte für komplexe Formen.",
      sections: "Raum-Abschnitte (L/T/U-Formen)",
      sectionsHint: "Fügen Sie mehrere Abschnitte hinzu, um nicht-rechteckige Räume zu erstellen",
      addSection: "+ Abschnitt hinzufügen",
      sectionsList: "Abschnitte",
      deleteSection: "Abschnitt löschen",
      sectionProps: "Abschnitt-Eigenschaften",
      noSectionSelected: "– kein Abschnitt ausgewählt –",
      sectionAdded: "Abschnitt hinzugefügt",
      sectionDeleted: "Abschnitt gelöscht",
      sectionChanged: "Abschnitt geändert"
    },
    skirting: {
      title: "Sockelleisten Konfiguration",
      enabled: "Sockelleisten aktivieren",
      type: "Art der Sockelleiste",
      typeCutout: "Selbst geschnitten (aus Fliesen)",
      typeBought: "Fertig gekauft (Stück)",
      height: "Höhe Sockelleiste (cm)",
      boughtWidth: "Länge pro Stück (cm)",
      pricePerPiece: "Preis pro Stück (€)",
      showSkirting: "Sockelleisten in Vorschau anzeigen",
      changed: "Sockelleisten geändert",
      totalLength: "Gesamtlänge (cm)",
      pieces: "Stückzahl",
      additionalTiles: "Zusätzliche Fliesen",
      stripsPerTile: "Streifen / Fliese"
    },
    secProps: {
      label: "Bezeichnung",
      x: "X (cm)",
      y: "Y (cm)",
      width: "Breite (cm)",
      height: "Höhe (cm)"
    },
    tile: {
      title: "Fliesen",
      sectionTiles: "Fliesen & Fuge",
      sectionPattern: "Muster",
      sectionPosition: "Position & Offset",
      sectionPricing: "Preis & Verschnitt",
      shape: "Fliesenform",
      shapeRect: "Rechteckig",
      shapeSquare: "Quadratisch",
      shapeHex: "Sechseckig",
      shapeRhombus: "Raute",
      width: "Fliese Breite (cm)",
      height: "Fliese Länge (cm)",
      hexHint: "Bei Sechsecken: Breite = Flach-zu-Flach-Abstand. Höhe wird automatisch berechnet.",
      grout: "Fuge (cm)",
      groutColor: "Fugenfarbe",
      pattern: "Muster",
      patternGrid: "Grid",
      patternRunningBond: "Running Bond",
      patternHerringbone: "Fischgrätmuster",
      patternDoubleHerringbone: "Doppeltes Fischgrätmuster",
      patternBasketweave: "Flechtmuster",
      patternVerticalStackAlternating: "Vertikaler Verband (alternierend)",
      bondFraction: "Running Bond Anteil",
      rotation: "Rotation (°)",
      offsetX: "Offset X (cm)",
      offsetY: "Offset Y (cm)",
      changed: "Parameter geändert",
      patternChanged: "Muster geändert",
      offsetChanged: "Offset geändert"
    },
    pricing: {
      title: "Preis",
      pricePerM2: "Preis pro m² (€)",
      packSize: "Packungsgröße (m²)",
      reserve: "Reserve (Fliesen)"
    },
    waste: {
      allowRotate: "Reststücke drehen (Reuse)",
      optimizeCuts: "Verschnitt optimieren (Zuschnitt erlaubt)",
      kerfWidth: "Schnittbreite / Kerf (cm)",
      changed: "Reuse geändert",
      optimizeChanged: "Verschnitt-Optimierung geändert"
    },
    origin: {
      preset: "Startpunkt Preset",
      presetTL: "oben links",
      presetTR: "oben rechts",
      presetBL: "unten links",
      presetBR: "unten rechts",
      presetCenter: "Mitte",
      presetFree: "frei",
      x: "Startpunkt X (cm) (nur frei)",
      y: "Startpunkt Y (cm) (nur frei)"
    },
    exclusions: {
      title: "Ausschlussbereiche",
      addRect: "+ Rechteck",
      addCircle: "+ Kreis",
      addTriangle: "+ Dreieck",
      delete: "Löschen",
      list: "Liste",
      dragHint: "Drag im Plan verschiebt die Auswahl. Commit erst bei Drag-Ende.",
      properties: "Eigenschaften (Auswahl)",
      noneSelected: "– nichts ausgewählt –",
      label: "Bezeichnung",
      added: "Ausschluss hinzugefügt",
      deleted: "Ausschluss gelöscht",
      changed: "Ausschluss geändert",
      moved: "Ausschluss verschoben",
      rect: "Rechteck",
      circle: "Kreis",
      triangle: "Dreieck",
      outside: "Ausschluss außerhalb Raum"
    },
    exclProps: {
      x: "X (cm)",
      y: "Y (cm)",
      width: "Breite (cm)",
      height: "Höhe (cm)",
      centerX: "Mitte X (cm)",
      centerY: "Mitte Y (cm)",
      radius: "Radius (cm)",
      p1x: "P1 X (cm)",
      p1y: "P1 Y (cm)",
      p2x: "P2 X (cm)",
      p2y: "P2 Y (cm)",
      p3x: "P3 X (cm)",
      p3y: "P3 Y (cm)"
    },
    undo: {
      title: "Undo / Redo",
      history: "Verlauf",
      undo: "Undo",
      redo: "Redo",
      lastAction: "Letzte Aktion:",
      undoCount: "Undo:",
      redoCount: "Redo:"
    },
    importExport: {
      title: "Import / Export",
      export: "Export JSON",
      import: "Import JSON",
      copy: "Copy State",
      hint: "Import ist undo-bar. Projekt speichern/laden nicht.",
      importFailed: "Import fehlgeschlagen: JSON nicht lesbar.",
      importRejected: "Import abgelehnt (Errors):",
      stateCopied: "State kopiert.",
      copyFailed: "Copy fehlgeschlagen (Clipboard nicht verfügbar)."
    },
    warnings: {
      title: "Hinweise",
      none: "Keine Hinweise",
      validationOk: "Validierung ok.",
      error: "Muster kann nicht angezeigt werden",
      warn: "Hinweis"
    },
    validation: {
      noRoomSelected: "Kein Raum ausgewählt",
      selectRoom: "Bitte wählen Sie einen Raum aus.",
      roomWidthInvalid: "Raumbreite ungültig",
      roomWidthText: "Muss eine positive Zahl > 0 sein.",
      roomHeightInvalid: "Raumlänge ungültig",
      roomHeightText: "Muss eine positive Zahl > 0 sein.",
      tileWidthInvalid: "Fliesenbreite ungültig",
      tileWidthText: "Muss eine positive Zahl > 0 sein.",
      tileHeightInvalid: "Fliesenlänge ungültig",
      tileHeightText: "Muss eine positive Zahl > 0 sein.",
      groutInvalid: "Fuge ungültig",
      groutText: "Muss eine Zahl ≥ 0 sein.",
      herringboneRatioTitle: "Herringbone Verhältnis ungültig",
      herringboneRatioText: "Für Fischgrätmuster muss die lange Seite genau in die kurze Seite passen (z. B. 2:1, 3:1). Aktuelles Verhältnis:",
      doubleHerringboneRatioTitle: "Double Herringbone Verhältnis ungültig",
      doubleHerringboneRatioText: "Für Double Herringbone muss die lange Seite genau in das Doppelte der kurzen Seite passen (z. B. 4:1, 6:1). Aktuelles Verhältnis:",
      basketweaveRatioTitle: "Basketweave Verhältnis ungültig",
      basketweaveRatioText: "Für Basketweave muss die lange Seite genau in die kurze Seite passen (z. B. 2:1, 3:1). Aktuelles Verhältnis:",
      rotationWarning: "Rotation außerhalb 45° Raster",
      rotationText: "MVP: 0..315 in 45°-Schritten.",
      invalid: "ist ungültig.",
      exclOutside: "liegt teilweise außerhalb.",
      currentValue: "Aktueller Wert:"
    },
    metrics: {
      title: "Berechnung",
      totalTiles: "Fliesen gesamt:",
      fullTiles: "Fliesen (voll):",
      cutTiles: "Fliesen (Schnitt):",
      reusedCuts: "Wiederverwendet (Cuts):",
      allowRotate: "Drehen erlaubt:",
      optimizeCuts: "Verschnitt optimieren:",
      waste: "Verschnitt (Einkauf):",
      netArea: "Fläche (Netto):",
      tilePacks: "Packungen:",
      price: "Preis:",
      cutWork: "Beschnitt (Aufwand):",
      yes: "Ja",
      no: "Nein",
      grandTotal: "Gesamtsumme (Inkl. Sockelleisten)",
      totalTilesToOrder: "Fliesen gesamt:",
      totalPacksToOrder: "Packungen gesamt:",
      totalCostToOrder: "Gesamtkosten:"
    },
    plan: {
      title: "Plan (SVG)",
      hint: "Tipp: Klick wählt aus • Drag verschiebt • Tiles kommen aus Fliesen & Muster"
    },
    state: {
      title: "Live State (read-only)"
    },
    debug: {
      title: "Debug",
      sectionOptions: "Debug Optionen",
      showNeeds: "Reststück-Bedarf anzeigen",
      changed: "Debug geändert"
    },
    init: {
      withSession: "Init (Session)",
      default: "Init"
    },
    errors: {
      renderFailed: "Fehler: Rendering fehlgeschlagen",
      reloadPage: "Bitte Seite neu laden.",
      noSession: "Keine gültige Session gefunden.",
      sessionRestored: "Letzten Stand wiederhergestellt"
    },
    language: {
      select: "Sprache:",
      german: "Deutsch",
      english: "English"
    }
  },
  en: {
    app: {
      title: "FloorPlanner – Phase 3 (Tiles + Pattern)",
      subtitle: "SVG Preview • Drag&Drop Exclusions • Tiles: Grid + Running Bond",
      autosave: "Autosave: ON"
    },
    session: {
      title: "Session",
      reset: "Reset",
      restore: "Restore Last State",
      status: "Session:",
      lastSaved: "Last Saved:",
      present: "present"
    },
    project: {
      title: "Project (local)",
      namePlaceholder: "e.g. Bathroom Ground Floor",
      nameLabel: "Name (for saving)",
      save: "Save Project",
      savedProjects: "Saved Projects",
      load: "Load Project (replaces state)",
      delete: "Delete Project",
      saved: "Project saved",
      loaded: "Project loaded",
      deleted: "Project deleted",
      notFound: "Project not found.",
      none: "– none –"
    },
    structure: {
      title: "Structure",
      floor: "Floor",
      room: "Room",
      addFloor: "Add Floor",
      deleteFloor: "Delete Floor",
      floorName: "Floor Name",
      addRoom: "Add Room",
      deleteRoom: "Delete Room",
      floorAdded: "Floor added",
      floorDeleted: "Floor deleted",
      floorChanged: "Floor changed",
      roomAdded: "Room added",
      roomDeleted: "Room deleted"
    },
    room: {
      title: "Room Details",
      sectionDisplay: "Display",
      name: "Room Name",
      width: "Width (cm)",
      height: "Length (cm)",
      showGrid: "Show Grid",
      changed: "Room changed",
      viewChanged: "View changed",
      legacyHint: "Legacy: Single rectangle. Use sections below for complex shapes.",
      sections: "Room Sections (L/T/U shapes)",
      sectionsHint: "Add multiple sections to create non-rectangular rooms",
      addSection: "+ Add Section",
      sectionsList: "Sections",
      deleteSection: "Delete Section",
      sectionProps: "Section Properties",
      noSectionSelected: "– no section selected –",
      sectionAdded: "Section added",
      sectionDeleted: "Section deleted",
      sectionChanged: "Section changed"
    },
    skirting: {
      title: "Skirting Configuration",
      enabled: "Enable skirting",
      type: "Type of skirting",
      typeCutout: "Self-made (cut from tiles)",
      typeBought: "Ready-made (per piece)",
      height: "Skirting height (cm)",
      boughtWidth: "Length per piece (cm)",
      pricePerPiece: "Price per piece (€)",
      showSkirting: "Show skirting in preview",
      changed: "Skirting changed",
      totalLength: "Total length (cm)",
      pieces: "Pieces (qty)",
      additionalTiles: "Sacrificed tiles (qty)",
      stripsPerTile: "Strips / Tile"
    },
    secProps: {
      label: "Label",
      x: "X (cm)",
      y: "Y (cm)",
      width: "Width (cm)",
      height: "Height (cm)"
    },
    tile: {
      title: "Tiles",
      sectionTiles: "Tiles & Grout",
      sectionPattern: "Pattern",
      sectionPosition: "Position & Offset",
      sectionPricing: "Pricing & Waste",
      shape: "Tile Shape",
      shapeRect: "Rectangular",
      shapeSquare: "Square",
      shapeHex: "Hexagonal",
      shapeRhombus: "Rhombus",
      width: "Tile Width (cm)",
      height: "Tile Height (cm)",
      hexHint: "For hexagons: width = flat-to-flat distance. Height is auto-calculated.",
      grout: "Grout (cm)",
      groutColor: "Grout Color",
      pattern: "Pattern",
      patternGrid: "Grid",
      patternRunningBond: "Running Bond",
      patternHerringbone: "Herringbone",
      patternDoubleHerringbone: "Double Herringbone",
      patternBasketweave: "Basketweave",
      patternVerticalStackAlternating: "Vertical Stack Alternating",
      bondFraction: "Running Bond Fraction",
      rotation: "Rotation (°)",
      offsetX: "Offset X (cm)",
      offsetY: "Offset Y (cm)",
      changed: "Parameters changed",
      patternChanged: "Pattern changed",
      offsetChanged: "Offset changed"
    },
    pricing: {
      title: "Pricing",
      pricePerM2: "Price per m² (€)",
      packSize: "Pack Size (m²)",
      reserve: "Reserve (tiles)"
    },
    waste: {
      allowRotate: "Rotate leftovers (Reuse)",
      optimizeCuts: "Optimize waste (allow cutting)",
      kerfWidth: "Kerf Width (cm)",
      changed: "Reuse changed",
      optimizeChanged: "Waste optimization changed"
    },
    origin: {
      preset: "Origin Preset",
      presetTL: "top left",
      presetTR: "top right",
      presetBL: "bottom left",
      presetBR: "bottom right",
      presetCenter: "center",
      presetFree: "free",
      x: "Origin X (cm) (free only)",
      y: "Origin Y (cm) (free only)"
    },
    exclusions: {
      title: "Exclusion Areas",
      addRect: "+ Rectangle",
      addCircle: "+ Circle",
      addTriangle: "+ Triangle",
      delete: "Delete",
      list: "List",
      dragHint: "Drag in plan moves selection. Commits on drag end.",
      properties: "Properties (Selection)",
      noneSelected: "– nothing selected –",
      label: "Label",
      added: "Exclusion added",
      deleted: "Exclusion deleted",
      changed: "Exclusion changed",
      moved: "Exclusion moved",
      rect: "Rectangle",
      circle: "Circle",
      triangle: "Triangle",
      outside: "Exclusion outside room"
    },
    exclProps: {
      x: "X (cm)",
      y: "Y (cm)",
      width: "Width (cm)",
      height: "Height (cm)",
      centerX: "Center X (cm)",
      centerY: "Center Y (cm)",
      radius: "Radius (cm)",
      p1x: "P1 X (cm)",
      p1y: "P1 Y (cm)",
      p2x: "P2 X (cm)",
      p2y: "P2 Y (cm)",
      p3x: "P3 X (cm)",
      p3y: "P3 Y (cm)"
    },
    undo: {
      title: "Undo / Redo",
      history: "History",
      undo: "Undo",
      redo: "Redo",
      lastAction: "Last Action:",
      undoCount: "Undo:",
      redoCount: "Redo:"
    },
    importExport: {
      title: "Import / Export",
      export: "Export JSON",
      import: "Import JSON",
      copy: "Copy State",
      hint: "Import is undo-able. Project save/load is not.",
      importFailed: "Import failed: JSON not readable.",
      importRejected: "Import rejected (Errors):",
      stateCopied: "State copied.",
      copyFailed: "Copy failed (Clipboard not available)."
    },
    warnings: {
      title: "Hints",
      none: "No Hints",
      validationOk: "Validation OK.",
      error: "Can't display pattern",
      warn: "Hint"
    },
    validation: {
      noRoomSelected: "No room selected",
      selectRoom: "Please select a room.",
      roomWidthInvalid: "Room width invalid",
      roomWidthText: "Must be a positive number > 0.",
      roomHeightInvalid: "Room height invalid",
      roomHeightText: "Must be a positive number > 0.",
      tileWidthInvalid: "Tile width invalid",
      tileWidthText: "Must be a positive number > 0.",
      tileHeightInvalid: "Tile height invalid",
      tileHeightText: "Must be a positive number > 0.",
      groutInvalid: "Grout invalid",
      groutText: "Must be a number ≥ 0.",
      herringboneRatioTitle: "Herringbone ratio invalid",
      herringboneRatioText: "For herringbone, the long side must fit perfectly into the short side (e.g., 2:1, 3:1). Current ratio:",
      doubleHerringboneRatioTitle: "Double herringbone ratio invalid",
      doubleHerringboneRatioText: "For double herringbone, the long side must fit perfectly into 2× the short side (e.g., 4:1, 6:1). Current ratio:",
      basketweaveRatioTitle: "Basketweave ratio invalid",
      basketweaveRatioText: "For basketweave, the long side must fit perfectly into the short side (e.g., 2:1, 3:1). Current ratio:",
      rotationWarning: "Rotation outside 45° grid",
      rotationText: "MVP: 0..315 in 45° steps.",
      invalid: "is invalid.",
      exclOutside: "is partially outside.",
      currentValue: "Current value:"
    },
    metrics: {
      title: "Calculation",
      totalTiles: "Total tiles:",
      fullTiles: "Full tiles:",
      cutTiles: "Cut tiles:",
      reusedCuts: "Reused (cuts):",
      allowRotate: "Rotation allowed:",
      optimizeCuts: "Optimize waste:",
      waste: "Waste (purchase):",
      netArea: "Net area:",
      tilePacks: "Tile Packs:",
      price: "Price:",
      cutWork: "Cut work:",
      yes: "Yes",
      no: "No",
      grandTotal: "Grand Total (incl. Skirting)",
      totalTilesToOrder: "Total tiles:",
      totalPacksToOrder: "Total packs:",
      totalCostToOrder: "Total cost:"
    },
    plan: {
      title: "Plan (SVG)",
      hint: "Tip: Click selects • Drag moves • Tiles come from Tiles & Pattern"
    },
    state: {
      title: "Live State (read-only)"
    },
    debug: {
      title: "Debug",
      sectionOptions: "Debug Options",
      showNeeds: "Show leftover needs",
      changed: "Debug changed"
    },
    init: {
      withSession: "Init (Session)",
      default: "Init"
    },
    errors: {
      renderFailed: "Error: Rendering failed",
      reloadPage: "Please reload page.",
      noSession: "No valid session found.",
      sessionRestored: "Last state restored"
    },
    language: {
      select: "Language:",
      german: "Deutsch",
      english: "English"
    }
  }
};

let currentLang = "de";

try {
  if (typeof localStorage !== "undefined") {
    currentLang = localStorage.getItem("floorplanner_lang") || "de";
  }
} catch (e) {
  currentLang = "de";
}

export function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("floorplanner_lang", lang);
      }
    } catch (e) {
      // localStorage not available
    }
  }
}

export function getLanguage() {
  return currentLang;
}

export function t(path) {
  const keys = path.split(".");
  let value = translations[currentLang];

  for (const key of keys) {
    if (value && typeof value === "object") {
      value = value[key];
    } else {
      return path;
    }
  }

  return value || path;
}
