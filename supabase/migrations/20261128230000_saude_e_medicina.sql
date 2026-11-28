-- Nome do módulo deixa claro que inclui a parte médica (exames, remédios, consultas, especialidades).
update public.modules set name = 'Saúde e Medicina', description = 'Exames, remédios, consultas, especialidades e sintomas'
 where key = 'saude';
