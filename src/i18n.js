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
      addRoom: "Raum hinzufügen",
      deleteRoom: "Raum löschen",
      floorAdded: "Etage hinzugefügt",
      floorDeleted: "Etage gelöscht",
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
      viewChanged: "Ansicht geändert"
    },
    tile: {
      title: "Fliesen",
      sectionTiles: "Fliesen & Fuge",
      sectionPattern: "Muster",
      sectionPosition: "Position & Offset",
      sectionPricing: "Preis & Verschnitt",
      width: "Fliese Breite (cm)",
      height: "Fliese Länge (cm)",
      grout: "Fuge (cm)",
      pattern: "Muster",
      patternGrid: "Grid",
      patternRunningBond: "Running Bond",
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
      title: "Warnungen",
      none: "Keine Warnungen",
      validationOk: "Validierung ok.",
      error: "Error",
      warn: "Warn"
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
      rotationWarning: "Rotation außerhalb 45° Raster",
      rotationText: "MVP: 0..315 in 45°-Schritten.",
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
      no: "Nein"
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
      addRoom: "Add Room",
      deleteRoom: "Delete Room",
      floorAdded: "Floor added",
      floorDeleted: "Floor deleted",
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
      viewChanged: "View changed"
    },
    tile: {
      title: "Tiles",
      sectionTiles: "Tiles & Grout",
      sectionPattern: "Pattern",
      sectionPosition: "Position & Offset",
      sectionPricing: "Pricing & Waste",
      width: "Tile Width (cm)",
      height: "Tile Height (cm)",
      grout: "Grout (cm)",
      pattern: "Pattern",
      patternGrid: "Grid",
      patternRunningBond: "Running Bond",
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
      title: "Warnings",
      none: "No Warnings",
      validationOk: "Validation OK.",
      error: "Error",
      warn: "Warn"
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
      rotationWarning: "Rotation outside 45° grid",
      rotationText: "MVP: 0..315 in 45° steps.",
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
      no: "No"
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
