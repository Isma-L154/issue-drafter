import type { IssueType } from "../../src/schema.ts";

export interface EvalNote {
  id: string;
  note: string;
  expectedType: IssueType;
  statesSteps: boolean;
}

// Real-style notes, deliberately informal. Spanish is allowed in this directory.
export const NOTES: EvalNote[] = [
  {
    id: "playlist-bug",
    note: "en loopify cuando meto una playlist de youtube muy larga tipo 300 canciones el bot se queda pegado como un minuto y a veces discord lo desconecta, debería cargar las primeras y seguir cargando el resto en segundo plano",
    expectedType: "bug",
    statesSteps: false,
  },
  {
    id: "filter-feature",
    note: "en histlow estaría bueno poder filtrar los logros por dificultad y que el filtro se quede guardado cuando vuelvo a la página",
    expectedType: "feature",
    statesSteps: false,
  },
  {
    id: "cleanup-task",
    note: "hay que revisar todo el código de nextsode, hay mucho código muerto y comentarios de más que no aportan nada",
    expectedType: "task",
    statesSteps: false,
  },
  {
    id: "undo-bug-with-steps",
    note: "en terravisual: abro un workspace, arrastro una caja encima de otra y le doy deshacer. la caja desaparece en vez de volver a donde estaba",
    expectedType: "bug",
    statesSteps: true,
  },
  {
    id: "vague-bug",
    note: "el login no sirve",
    expectedType: "bug",
    statesSteps: false,
  },
];
