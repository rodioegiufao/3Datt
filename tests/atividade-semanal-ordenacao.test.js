"use strict";

const assert = require("node:assert/strict");
const {
  extrairDataEntrega,
  ordenarAtividadesSemanais
} = require("../atividades/atividade-semanal-ordenacao");

assert.equal(extrairDataEntrega("Entrega prevista: 14/09/2026"), Date.UTC(2026, 8, 14));
assert.equal(extrairDataEntrega("31/02/2026"), null);
assert.equal(extrairDataEntrega("Sem previsão"), null);

const atividades = [
  { atividade: "P0", prioridade: "P0", entregas: "01/09/2026" },
  { atividade: "P3 posterior", prioridade: "P3", entregas: "23/09/2026" },
  { atividade: "P2 sem data", prioridade: "P2", entregas: "Relatório final" },
  { atividade: "P3 anterior", prioridade: "P3", entregas: "Revisão em 14/09/2026" },
  { atividade: "P1", prioridade: "P1", entregas: "06/10/2026" },
  { atividade: "P2 com data", prioridade: "P2", entregas: "18/09/2026" }
];

assert.deepEqual(
  ordenarAtividadesSemanais(atividades).map((item) => item.atividade),
  ["P3 anterior", "P3 posterior", "P2 com data", "P2 sem data", "P1", "P0"]
);
assert.equal(atividades[0].atividade, "P0", "a ordenação não deve alterar a lista original");

console.log("✓ Ordenação semanal validada por prioridade e data de entrega.");