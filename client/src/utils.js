export const weekdays = [
  { value: 1, short: 'Seg', label: 'Segunda' }, { value: 2, short: 'Ter', label: 'Terça' },
  { value: 3, short: 'Qua', label: 'Quarta' }, { value: 4, short: 'Qui', label: 'Quinta' },
  { value: 5, short: 'Sex', label: 'Sexta' }, { value: 6, short: 'Sáb', label: 'Sábado' },
  { value: 0, short: 'Dom', label: 'Domingo' }
];
export const formatDate = iso => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));
export const formatMinutes = value => `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}min` : ''}`;
export const statusText = { safe: 'Dentro do limite', limit: 'No limite', exceeded: 'Limite excedido' };
