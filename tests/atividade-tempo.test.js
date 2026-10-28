const assert = require("node:assert/strict");
const tempo = require("../atividades/atividade-tempo");

const atividade = { dataInicio: "2026-09-03", horaInicio: "08:00", dataTermino: "2026-09-03", horaTermino: "10:30" };
assert.equal(tempo.calcularHorasAtividade(atividade), 2.5);
assert.equal(tempo.calcularHorasAtividade({ ...atividade, horaTermino: "07:00" }), 0, "duração negativa é inválida");
assert.equal(tempo.calcularHorasAtividade({}), 0, "atividade sem fase/item e sem horário continua válida");
assert.equal(tempo.calcularHorasTrabalhadas([atividade, atividade]), 5);
assert.equal(tempo.calcularHorasAtividade({ consolidada: true, horasConsolidadas: "3.25" }), 3.25);
console.log("activity duration: ok");