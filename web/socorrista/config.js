// Endereço da plataforma central (VM da Univates).
// O app do socorrista roda no notebook (http://localhost:8080) e só fala com a
// VM para sincronizar. Se o app for aberto pela própria VM, usa o mesmo endereço.
export const SERVIDOR = location.hostname === 'medicalfield.duckdns.org' ? '' : 'https://medicalfield.duckdns.org';
