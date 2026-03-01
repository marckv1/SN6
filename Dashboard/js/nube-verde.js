// ============================================
// NUBE VERDE - MONITOR DE CONSUMO ENERGÉTICO
// Adaptado a estructura real de Firestore
// ============================================

// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAE_pViacv5LR9DpalknyS5nuu-TJcTsxw",
    authDomain: "nube-verde-monitor.firebaseapp.com",
    projectId: "nube-verde-monitor",
    storageBucket: "nube-verde-monitor.firebasestorage.app",
    messagingSenderId: "694437356246",
    appId: "1:694437356246:web:0b6792fd2a913727739f77"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Variables globales
let consumoChart = null;
let comparativoChart = null;
let historicoChart = null;
let rankingChart = null;
let proyeccionChart = null;
let distribucionChart = null;
let datosGlobales = {
    lecturas: [],
    puntos: [],
    alertas: [],
    usuarioActual: null,
    kpis: {},
    rankings: {},
    proyecciones: {}
};

// ============================================
// CONFIGURACIÓN DE UMBRALES Y REGLAS
// ============================================
const CONFIG_ALERTAS = {
    // Porcentajes sobre el consumo base para alertas
    UMBRAL_CRITICO: 1.5,      // >150% del base = crítico
    UMBRAL_ALTO: 1.3,         // >130% del base = alto
    UMBRAL_MEDIO: 1.2,        // >120% del base = medio (sostenido)

    // Horarios pico (para análisis)
    HORARIOS_PICO: {
        MANANA: { inicio: 8, fin: 12 },
        TARDE: { inicio: 14, fin: 18 }
    },

    // Factor esperado en picos
    FACTOR_PICO: 1.5,
    FACTOR_FIN_SEMANA: 0.3
};

// ============================================
// CONFIGURACIÓN DE KPIs Y COSTOS
// ============================================
const CONFIG_KPI = {
    // Factor de emisión de CO2 por kWh (promedio para El Salvador)
    FACTOR_CO2: 0.387,           // kg CO2 por kWh

    // Tarifa eléctrica promedio (pueden ajustarse según zona)
    TARIFA_PROMEDIO: 0.12,       // USD por kWh (residencial)
    TARIFA_INDUSTRIAL: 0.18,     // USD por kWh (industrial)

    // Umbrales de eficiencia
    EFICIENCIA_EXCELENTE: 90,    // <= 90% del base
    EFICIENCIA_BUENA: 110,       // <= 110% del base
    EFICIENCIA_ACEPTABLE: 130,   // <= 130% del base

    // Periodos para análisis
    DIAS_MES: 30,
    DIAS_PROYECCION: 7,          // días para proyección mensual
    HORAS_DIA: 24
};

// ============================================
// AUTENTICACIÓN
// ============================================

auth.onAuthStateChanged((user) => {
    if (user) {
        console.log("✅ Usuario autenticado:", user.email);
        datosGlobales.usuarioActual = user;
        actualizarUIUsuario(user);
        inicializarDashboard();
    } else {
        console.log("❌ Usuario no autenticado, redirigiendo a login...");
        window.location.href = 'login.html';
    }
});

function actualizarUIUsuario(user) {
    const nombreUsuario = user.displayName || user.email.split('@')[0];
    const elementoNombre = document.getElementById('nombreUsuario');
    if (elementoNombre) {
        elementoNombre.textContent = nombreUsuario;
    }
}

async function cerrarSesion() {
    try {
        await auth.signOut();
        console.log("👋 Sesión cerrada");
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Error al cerrar sesión:", error);
    }
}

// ============================================
// NAVEGACIÓN ENTRE SECCIONES
// ============================================

function mostrarSeccion(seccion) {
    // Ocultar todas las secciones
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    // Mostrar la sección seleccionada
    const seccionElement = document.getElementById(`${seccion}-section`);
    const navElement = document.getElementById(`nav-${seccion}`);
    
    if (seccionElement) seccionElement.classList.add('active');
    if (navElement) navElement.classList.add('active');
    
    // Cargar datos específicos de la sección
    if (seccion === 'puntos') cargarPuntos();
    if (seccion === 'historico') cargarHistorico();
    if (seccion === 'alertas') generarAlertas();
}

// ============================================
// OBTENCIÓN DE DATOS DESDE FIRESTORE
// ============================================

/**
 * Obtiene las lecturas de Firestore
 * Estructura real: { id_punto, consumo_kwh, estado, fecha }
 */
async function obtenerLecturas(limite = 200) {
    try {
        const snapshot = await db.collection('lecturas')
            .orderBy('fecha', 'desc')
            .limit(limite)
            .get();
        
        const lecturas = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            
            // Buscar el punto correspondiente para obtener datos base
            const punto = datosGlobales.puntos.find(p => p.id === data.id_punto);
            
            lecturas.push({
                id: doc.id,
                id_punto: data.id_punto,
                consumo_kwh: parseFloat(data.consumo_kwh) || 0,
                estado: data.estado || 'activo',
                fecha: data.fecha,
                // Campos calculados basados en el punto
                consumo_base: punto ? punto.consumo_base_kwh : 5.0,
                potencia_base: punto ? punto.potencia_base_w : 500,
                nombre_punto: punto ? punto.nombre : data.id_punto,
                ubicacion: punto ? punto.ubicacion : ''
            });
        });
        
        datosGlobales.lecturas = lecturas;
        console.log(`📊 ${lecturas.length} lecturas obtenidas`);
        return lecturas;
    } catch (error) {
        console.error("Error al obtener lecturas:", error);
        mostrarError("Error al cargar lecturas");
        return [];
    }
}

/**
 * Obtiene los puntos de monitoreo
 * Estructura real: { id, nombre, descripcion, ubicacion, activo, consumo_base_kwh, potencia_base_w }
 */
async function obtenerPuntos() {
    try {
        const snapshot = await db.collection('puntos_monitoreo').get();
        const puntos = [];
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            puntos.push({
                docId: doc.id,
                id: data.id,
                nombre: data.nombre || `Punto ${data.id}`,
                descripcion: data.descripcion || '',
                ubicacion: data.ubicacion || '',
                activo: data.activo ?? true,
                consumo_base_kwh: parseFloat(data.consumo_base_kwh) || 5.0,
                potencia_base_w: parseInt(data.potencia_base_w) || 500
            });
        });
        
        datosGlobales.puntos = puntos;
        console.log(`📍 ${puntos.length} puntos de monitoreo obtenidos`);
        return puntos;
    } catch (error) {
        console.error("Error al obtener puntos:", error);
        return [];
    }
}

/**
 * Escucha cambios en tiempo real en Firestore
 */
function escucharCambiosRealTime() {
    // Listener para lecturas
    db.collection('lecturas')
        .orderBy('fecha', 'desc')
        .limit(100)
        .onSnapshot((snapshot) => {
            console.log("🔄 Lecturas actualizadas en tiempo real");
            actualizarDashboard();
        }, (error) => {
            console.error("Error en listener de lecturas:", error);
        });
    
    // Listener para puntos_monitoreo (detecta cambios en campo 'activo', etc.)
    db.collection('puntos_monitoreo')
        .onSnapshot(async (snapshot) => {
            console.log("📍 Puntos de monitoreo actualizados en tiempo real");
            
            // Actualizar datos globales de puntos
            const puntos = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                puntos.push({
                    docId: doc.id,
                    id: data.id,
                    nombre: data.nombre || `Punto ${data.id}`,
                    descripcion: data.descripcion || '',
                    ubicacion: data.ubicacion || '',
                    activo: data.activo ?? true,
                    consumo_base_kwh: parseFloat(data.consumo_base_kwh) || 5.0,
                    potencia_base_w: parseInt(data.potencia_base_w) || 500
                });
            });
            
            datosGlobales.puntos = puntos;
            
            // Refrescar el dashboard con los nuevos datos de puntos
            await actualizarDashboard();
            
            // Si estamos en la sección de puntos, recargarla
            const seccionPuntos = document.getElementById('puntos-section');
            if (seccionPuntos && seccionPuntos.classList.contains('active')) {
                cargarPuntos();
            }
        }, (error) => {
            console.error("Error en listener de puntos:", error);
        });
}

// ============================================
// CÁLCULO DE MÉTRICAS
// ============================================

/**
 * Calcula KPIs avanzados de eficiencia energética
 */
function calcularKPIsAvanzados(lecturas) {
    const puntos = datosGlobales.puntos;
    const lecturasActivas = lecturas.filter(l => l.estado === 'activo');

    if (lecturasActivas.length === 0) {
        return getKPIsVacios();
    }

    // 1. Consumo total y promedio
    const consumoTotal = lecturasActivas.reduce((sum, l) => sum + l.consumo_kwh, 0);
    const consumoPromedio = consumoTotal / lecturasActivas.length;

    // 2. Calcular consumo base esperado total
    let consumoBaseTotal = 0;
    lecturasActivas.forEach(l => {
        consumoBaseTotal += l.consumo_base || 5.0;
    });
    const consumoBasePromedio = consumoBaseTotal / lecturasActivas.length;

    // 3. Eficiencia energética global (% sobre consumo base)
    const eficienciaGlobal = consumoBasePromedio > 0
        ? (consumoPromedio / consumoBasePromedio) * 100
        : 100;

    // 4. Huella de carbono (kg CO2)
    const huellaCarbono = consumoTotal * CONFIG_KPI.FACTOR_CO2;

    // 5. Costo estimado (USD)
    const costoEstimado = consumoTotal * CONFIG_KPI.TARIFA_PROMEDIO;

    // 6. Factor de potencia promedio
    const factorPotenciaPromedio = calcularFactorPotencia(lecturasActivas);

    // 7. Eficiencia por punto
    const eficienciaPorPunto = calcularEficienciaPorPunto(lecturasActivas, puntos);

    // 8. Clasificación de eficiencia
    const clasificacionEficiencia = getClasificacionEficiencia(eficienciaGlobal);

    // 9. Potencial de ahorro
    const potencialAhorro = calcularPotencialAhorro(lecturasActivas, puntos);

    return {
        consumoTotal: Number(consumoTotal.toFixed(2)),
        consumoPromedio: Number(consumoPromedio.toFixed(2)),
        consumoBaseTotal: Number(consumoBaseTotal.toFixed(2)),
        eficienciaGlobal: Number(eficienciaGlobal.toFixed(1)),
        huellaCarbono: Number(huellaCarbono.toFixed(2)),
        costoEstimado: Number(costoEstimado.toFixed(2)),
        factorPotenciaPromedio: Number(factorPotenciaPromedio.toFixed(3)),
        eficienciaPorPunto,
        clasificacionEficiencia,
        potencialAhorro: Number(potencialAhorro.toFixed(2)),
        ahorroPorcentual: Number(((potencialAhorro / consumoTotal) * 100).toFixed(1))
    };
}

/**
 * Calcula el factor de potencia (consumo real vs esperado según potencia base)
 */
function calcularFactorPotencia(lecturas) {
    if (lecturas.length === 0) return 0;

    let sumaFactores = 0;
    let count = 0;

    lecturas.forEach(l => {
        // Factor de potencia = consumo_kwh / (potencia_base_w / 1000)
        // Asumiendo que potencia_base_w está en watts y representa consumo esperado por hora
        const potenciaEsperadaKW = l.potencia_base / 1000; // Convertir a kW
        if (potenciaEsperadaKW > 0) {
            const factor = l.consumo_kwh / potenciaEsperadaKW;
            sumaFactores += factor;
            count++;
        }
    });

    return count > 0 ? sumaFactores / count : 0;
}

/**
 * Calcula eficiencia por cada punto de monitoreo
 */
function calcularEficienciaPorPunto(lecturas, puntos) {
    const eficienciaPorPunto = {};

    // Agrupar lecturas por punto
    const lecturasPorPunto = {};
    lecturas.forEach(l => {
        if (!lecturasPorPunto[l.id_punto]) {
            lecturasPorPunto[l.id_punto] = [];
        }
        lecturasPorPunto[l.id_punto].push(l);
    });

    // Calcular eficiencia para cada punto
    Object.entries(lecturasPorPunto).forEach(([idPunto, lecs]) => {
        const punto = puntos.find(p => p.id === idPunto);
        if (!punto) return;

        const consumoPromedio = lecs.reduce((s, l) => s + l.consumo_kwh, 0) / lecs.length;
        const consumoBase = punto.consumo_base_kwh;

        const eficiencia = consumoBase > 0
            ? (consumoPromedio / consumoBase) * 100
            : 100;

        eficienciaPorPunto[idPunto] = {
            nombre: punto.nombre,
            eficiencia: Number(eficiencia.toFixed(1)),
            consumoPromedio: Number(consumoPromedio.toFixed(2)),
            consumoBase: consumoBase,
            clasificacion: getClasificacionEficiencia(eficiencia),
            lecturas: lecs.length
        };
    });

    return eficienciaPorPunto;
}

/**
 * Calcula el potencial de ahorro (consumo excedente sobre el base)
 */
function calcularPotencialAhorro(lecturas, puntos) {
    let potencialAhorro = 0;

    lecturas.forEach(l => {
        const punto = puntos.find(p => p.id === l.id_punto);
        if (!punto) return;

        const consumoBase = punto.consumo_base_kwh;
        const excedente = Math.max(0, l.consumo_kwh - consumoBase);
        potencialAhorro += excedente;
    });

    return potencialAhorro;
}

/**
 * Obtiene clasificación de eficiencia según porcentaje
 */
function getClasificacionEficiencia(porcentaje) {
    if (porcentaje <= CONFIG_KPI.EFICIENCIA_EXCELENTE) {
        return { nivel: 'excelente', color: 'success', icono: 'star', texto: 'Excelente' };
    } else if (porcentaje <= CONFIG_KPI.EFICIENCIA_BUENA) {
        return { nivel: 'buena', color: 'success', icono: 'thumbs-up', texto: 'Buena' };
    } else if (porcentaje <= CONFIG_KPI.EFICIENCIA_ACEPTABLE) {
        return { nivel: 'aceptable', color: 'warning', icono: 'meh', texto: 'Aceptable' };
    } else {
        return { nivel: 'critica', color: 'danger', icono: 'exclamation-triangle', texto: 'Crítica' };
    }
}

/**
 * Retorna KPIs vacíos cuando no hay datos
 */
function getKPIsVacios() {
    return {
        consumoTotal: 0,
        consumoPromedio: 0,
        consumoBaseTotal: 0,
        eficienciaGlobal: 0,
        huellaCarbono: 0,
        costoEstimado: 0,
        factorPotenciaPromedio: 0,
        eficienciaPorPunto: {},
        clasificacionEficiencia: getClasificacionEficiencia(0),
        potencialAhorro: 0,
        ahorroPorcentual: 0
    };
}

/**
 * Calcula rankings de consumo
 */
function calcularRankings(lecturas) {
    const puntos = datosGlobales.puntos;
    const lecturasActivas = lecturas.filter(l => l.estado === 'activo');

    // Agrupar consumo por punto
    const consumoPorPunto = {};
    const lecturasPorPunto = {};

    lecturasActivas.forEach(l => {
        if (!consumoPorPunto[l.id_punto]) {
            consumoPorPunto[l.id_punto] = 0;
            lecturasPorPunto[l.id_punto] = [];
        }
        consumoPorPunto[l.id_punto] += l.consumo_kwh;
        lecturasPorPunto[l.id_punto].push(l);
    });

    // Ranking de mayores consumidores
    const rankingConsumo = Object.entries(consumoPorPunto)
        .map(([idPunto, consumo]) => {
            const punto = puntos.find(p => p.id === idPunto);
            const lecturasPunto = lecturasPorPunto[idPunto];
            const consumoPromedio = consumo / lecturasPunto.length;
            const consumoBase = punto ? punto.consumo_base_kwh : 5.0;
            const eficiencia = (consumoPromedio / consumoBase) * 100;

            return {
                idPunto,
                nombre: punto ? punto.nombre : idPunto,
                ubicacion: punto ? punto.ubicacion : '',
                consumoTotal: Number(consumo.toFixed(2)),
                consumoPromedio: Number(consumoPromedio.toFixed(2)),
                consumoBase,
                eficiencia: Number(eficiencia.toFixed(1)),
                lecturas: lecturasPunto.length
            };
        })
        .sort((a, b) => b.consumoTotal - a.consumoTotal)
        .slice(0, 5);

    // Ranking de menos eficientes (mayor % sobre base)
    const rankingIneficiencia = Object.values(consumoPorPunto)
        .map((consumo, idx, arr) => {
            const idPunto = Object.keys(consumoPorPunto)[idx];
            const punto = puntos.find(p => p.id === idPunto);
            const lecturasPunto = lecturasPorPunto[idPunto];
            const consumoPromedio = consumo / lecturasPunto.length;
            const consumoBase = punto ? punto.consumo_base_kwh : 5.0;
            const eficiencia = (consumoPromedio / consumoBase) * 100;
            const excedente = consumo - (consumoBase * lecturasPunto.length);

            return {
                idPunto,
                nombre: punto ? punto.nombre : idPunto,
                ubicacion: punto ? punto.ubicacion : '',
                eficiencia: Number(eficiencia.toFixed(1)),
                consumoTotal: Number(consumo.toFixed(2)),
                consumoBase,
                excedente: Number(excedente.toFixed(2)),
                excedentePorcentual: Number(((excedente / consumo) * 100).toFixed(1))
            };
        })
        .sort((a, b) => b.eficiencia - a.eficiencia)
        .slice(0, 5);

    // Detectar anomalías (picos inusuales)
    const anomalias = detectarAnomalias(lecturasActivas, puntos);

    return {
        topConsumidores: rankingConsumo,
        topIneficientes: rankingIneficiencia,
        anomalias
    };
}

/**
 * Detecta anomalías en los patrones de consumo
 */
function detectarAnomalias(lecturas, puntos) {
    const anomalias = [];

    // Agrupar por punto
    const lecturasPorPunto = {};
    lecturas.forEach(l => {
        if (!lecturasPorPunto[l.id_punto]) {
            lecturasPorPunto[l.id_punto] = [];
        }
        lecturasPorPunto[l.id_punto].push(l);
    });

    Object.entries(lecturasPorPunto).forEach(([idPunto, lecs]) => {
        if (lecs.length < 5) return; // Necesitamos al menos 5 lecturas

        const punto = puntos.find(p => p.id === idPunto);
        if (!punto) return;

        // Calcular promedio y desviación estándar
        const consumos = lecs.map(l => l.consumo_kwh);
        const promedio = consumos.reduce((s, c) => s + c, 0) / consumos.length;
        const varianza = consumos.reduce((s, c) => s + Math.pow(c - promedio, 2), 0) / consumos.length;
        const desviacion = Math.sqrt(varianza);

        // Buscar lecturas que estén 2 desviaciones estándar arriba del promedio
        lecs.forEach(l => {
            if (l.consumo_kwh > promedio + (2 * desviacion)) {
                anomalias.push({
                    idPunto,
                    nombre: punto.nombre,
                    consumo: l.consumo_kwh,
                    promedio: Number(promedio.toFixed(2)),
                    desviacion: Number(desviacion.toFixed(2)),
                    zScore: Number(((l.consumo_kwh - promedio) / desviacion).toFixed(2)),
                    fecha: l.fecha,
                    severidad: l.consumo_kwh > promedio + (3 * desviacion) ? 'alta' : 'media'
                });
            }
        });
    });

    return anomalias.sort((a, b) => b.zScore - a.zScore).slice(0, 10);
}

/**
 * Calcula proyecciones de consumo
 */
function calcularProyecciones(lecturas) {
    const lecturasActivas = lecturas.filter(l => l.estado === 'activo');

    // Reducimos el mínimo requerido de 7 a solo 2 lecturas
    if (lecturasActivas.length < 2) {
        return getProyeccionesVacias();
    }

    // Obtener consumo diario de los últimos días
    const consumoDiario = agruparConsumoPorDia(lecturasActivas);

    // Calcular tendencia - usamos todos los días disponibles
    const diasRecientes = Object.entries(consumoDiario)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, CONFIG_KPI.DIAS_PROYECCION);

    if (diasRecientes.length < 1) {
        return getProyeccionesVacias();
    }

    // Calcular promedio diario reciente
    const promedioDiario = diasRecientes.reduce((s, [_, data]) => s + data.total, 0) / diasRecientes.length;

    // Calcular tasa de crecimiento (ajustado para funcionar con menos días)
    let tasaCrecimiento = 0;
    if (diasRecientes.length >= 2) {
        const mitad = Math.ceil(diasRecientes.length / 2);
        const primerosDias = diasRecientes.slice(-mitad);
        const ultimosDias = diasRecientes.slice(0, mitad);
        const promedioPrimeros = primerosDias.reduce((s, [_, d]) => s + d.total, 0) / primerosDias.length;
        const promedioUltimos = ultimosDias.reduce((s, [_, d]) => s + d.total, 0) / ultimosDias.length;
        tasaCrecimiento = promedioPrimeros > 0
            ? ((promedioUltimos - promedioPrimeros) / promedioPrimeros) * 100
            : 0;
    }

    // Proyección mensual
    const proyeccionMensual = promedioDiario * CONFIG_KPI.DIAS_MES;
    const costoMensualProyectado = proyeccionMensual * CONFIG_KPI.TARIFA_PROMEDIO;
    const co2MensualProyectado = proyeccionMensual * CONFIG_KPI.FACTOR_CO2;

    // Comparación con mes anterior (estimado)
    const consumoMesActual = Object.values(consumoDiario).reduce((s, d) => s + d.total, 0);
    const diasConDatos = Object.keys(consumoDiario).length;
    const consumoTotalMesAnterior = lecturasActivas.reduce((s, l) => s + l.consumo_kwh, 0);

    return {
        promedioDiario: Number(promedioDiario.toFixed(2)),
        proyeccionMensual: Number(proyeccionMensual.toFixed(2)),
        costoMensualProyectado: Number(costoMensualProyectado.toFixed(2)),
        co2MensualProyectado: Number(co2MensualProyectado.toFixed(2)),
        tasaCrecimiento: Number(tasaCrecimiento.toFixed(1)),
        tendencia: tasaCrecimiento > 5 ? 'alcista' : tasaCrecimiento < -5 ? 'bajista' : 'estable',
        diasAnalizados: diasRecientes.length,
        consumoMesActual: Number(consumoMesActual.toFixed(2)),
        diasConDatos
    };
}

/**
 * Agrupa consumo por día
 */
function agruparConsumoPorDia(lecturas) {
    const consumoPorDia = {};

    lecturas.forEach(l => {
        if (!l.fecha) return;
        const fecha = l.fecha.toDate ? l.fecha.toDate() : new Date(l.fecha);
        const dia = fecha.toISOString().split('T')[0];

        if (!consumoPorDia[dia]) {
            consumoPorDia[dia] = { total: 0, count: 0 };
        }
        consumoPorDia[dia].total += l.consumo_kwh;
        consumoPorDia[dia].count++;
    });

    return consumoPorDia;
}

/**
 * Retorna proyecciones vacías
 */
function getProyeccionesVacias() {
    return {
        promedioDiario: 0,
        proyeccionMensual: 0,
        costoMensualProyectado: 0,
        co2MensualProyectado: 0,
        tasaCrecimiento: 0,
        tendencia: 'estable',
        diasAnalizados: 0,
        consumoMesActual: 0,
        diasConDatos: 0
    };
}

// ============================================
// CÁLCULO DE MÉTRICAS EXISTENTE (Mantenido)
// ============================================

function calcularMetricas(lecturas) {
    // Obtener puntos de la colección puntos_monitoreo (datos reales)
    const puntos = datosGlobales.puntos;
    
    // Contar puntos activos/inactivos desde la colección puntos_monitoreo
    const puntosActivos = puntos.filter(p => p.activo === true).length;
    const puntosInactivos = puntos.filter(p => p.activo === false).length;
    const totalPuntos = puntos.length;
    
    if (lecturas.length === 0) {
        return {
            consumoTotal: 0,
            consumoPromedio: 0,
            puntosActivos,
            puntosInactivos,
            totalPuntos,
            lecturasHoy: 0,
            tendencia: 0,
            esPico: false
        };
    }

    // Filtrar solo lecturas con estado 'activo' (el sensor reportó datos)
    const lecturasConDatos = lecturas.filter(l => l.estado === 'activo');
    
    // Calcular consumo total
    const consumoTotal = lecturasConDatos.reduce((sum, l) => sum + l.consumo_kwh, 0);
    
    // Calcular promedio
    const consumoPromedio = lecturasConDatos.length > 0 
        ? consumoTotal / lecturasConDatos.length 
        : 0;
    
    // Lecturas de hoy
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const lecturasHoy = lecturas.filter(l => {
        if (!l.fecha) return false;
        const fechaLectura = l.fecha.toDate ? l.fecha.toDate() : new Date(l.fecha);
        return fechaLectura >= hoy;
    }).length;
    
    // Calcular tendencia (comparar últimas 10 con anteriores 10)
    let tendencia = 0;
    if (lecturasConDatos.length >= 20) {
        const recientes = lecturasConDatos.slice(0, 10);
        const anteriores = lecturasConDatos.slice(10, 20);
        const promedioReciente = recientes.reduce((s, l) => s + l.consumo_kwh, 0) / 10;
        const promedioAnterior = anteriores.reduce((s, l) => s + l.consumo_kwh, 0) / 10;
        if (promedioAnterior > 0) {
            tendencia = ((promedioReciente - promedioAnterior) / promedioAnterior) * 100;
        }
    }
    
    // Verificar si estamos en horario pico
    const horaActual = new Date().getHours();
    const esPico = esHorarioPico(horaActual);
    
    return {
        consumoTotal: Number(consumoTotal.toFixed(2)),
        consumoPromedio: Number(consumoPromedio.toFixed(2)),
        puntosActivos,
        puntosInactivos,
        totalPuntos,
        lecturasHoy,
        tendencia: Number(tendencia.toFixed(1)),
        esPico
    };
}

function esHorarioPico(hora) {
    const { MANANA, TARDE } = CONFIG_ALERTAS.HORARIOS_PICO;
    return (hora >= MANANA.inicio && hora < MANANA.fin) || 
           (hora >= TARDE.inicio && hora < TARDE.fin);
}

function esFinDeSemana() {
    const dia = new Date().getDay();
    return dia === 0 || dia === 6;
}

// ============================================
// ACTUALIZACIÓN DE UI - DASHBOARD
// ============================================

/**
 * Actualiza las tarjetas de KPIs avanzados
 */
function actualizarTarjetasKPIs(kpis) {
    // Eficiencia global
    const eficienciaEl = document.getElementById('eficiencia-global');
    if (eficienciaEl) {
        const clase = kpis.clasificacionEficiencia.color;
        eficienciaEl.innerHTML = `
            <div class="text-xs font-weight-bold text-${clase} text-uppercase mb-1">Eficiencia Energética</div>
            <div class="h5 mb-0 font-weight-bold text-gray-800">${kpis.eficienciaGlobal}%</div>
            <small class="text-muted">Clasificación: <span class="text-${clase}">${kpis.clasificacionEficiencia.texto}</span></small>
        `;
    }

    // Huella de carbono
    const co2El = document.getElementById('huella-carbono');
    if (co2El) {
        co2El.innerHTML = `
            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Huella de Carbono</div>
            <div class="h5 mb-0 font-weight-bold text-gray-800">${kpis.huellaCarbono} kg</div>
            <small class="text-muted">CO₂ emitido</small>
        `;
    }

    // Costo estimado
    const costoEl = document.getElementById('costo-estimado');
    if (costoEl) {
        costoEl.innerHTML = `
            <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Costo Estimado</div>
            <div class="h5 mb-0 font-weight-bold text-gray-800">$${kpis.costoEstimado}</div>
            <small class="text-muted">USD totales</small>
        `;
    }

    // Potencial de ahorro
    const ahorroEl = document.getElementById('potencial-ahorro');
    if (ahorroEl) {
        const ahorroColor = kpis.ahorroPorcentual > 20 ? 'danger' : kpis.ahorroPorcentual > 10 ? 'warning' : 'success';
        ahorroEl.innerHTML = `
            <div class="text-xs font-weight-bold text-${ahorroColor} text-uppercase mb-1">Potencial de Ahorro</div>
            <div class="h5 mb-0 font-weight-bold text-gray-800">${kpis.potencialAhorro} kWh</div>
            <small class="text-${ahorroColor}">${kpis.ahorroPorcentual}% sobre consumo</small>
        `;
    }
}

/**
 * Actualiza panel de proyecciones
 */
function actualizarPanelProyecciones(proyecciones) {
    const panelEl = document.getElementById('panel-proyecciones');
    if (!panelEl) return;

    const tendenciaIcono = proyecciones.tendencia === 'alcista' ? 'arrow-up text-danger'
        : proyecciones.tendencia === 'bajista' ? 'arrow-down text-success'
        : 'minus text-info';

    panelEl.innerHTML = `
        <div class="row text-center">
            <div class="col-md-3 mb-3">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="text-xs text-muted text-uppercase mb-1">Promedio Diario</div>
                        <div class="h4 mb-0 font-weight-bold text-primary">${proyecciones.promedioDiario} kWh</div>
                    </div>
                </div>
            </div>
            <div class="col-md-3 mb-3">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="text-xs text-muted text-uppercase mb-1">Proyección Mensual</div>
                        <div class="h4 mb-0 font-weight-bold text-gray-800">${proyecciones.proyeccionMensual} kWh</div>
                    </div>
                </div>
            </div>
            <div class="col-md-3 mb-3">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="text-xs text-muted text-uppercase mb-1">Costo Mensual</div>
                        <div class="h4 mb-0 font-weight-bold text-warning">$${proyecciones.costoMensualProyectado}</div>
                    </div>
                </div>
            </div>
            <div class="col-md-3 mb-3">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="text-xs text-muted text-uppercase mb-1">Tendencia</div>
                        <div class="h4 mb-0">
                            <i class="fas fa-${tendenciaIcono}"></i>
                            <span class="font-weight-bold">${proyecciones.tasaCrecimiento}%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Actualiza tabla de rankings
 */
function actualizarTablaRankings(rankings) {
    const topConsumidoresEl = document.getElementById('tabla-top-consumidores');
    const topIneficientesEl = document.getElementById('tabla-top-ineficientes');
    const anomaliasEl = document.getElementById('tabla-anomalias');

    // Top consumidores
    if (topConsumidoresEl) {
        if (rankings.topConsumidores.length === 0) {
            topConsumidoresEl.innerHTML = '<tr><td colspan="4" class="text-center">No hay datos disponibles</td></tr>';
        } else {
            topConsumidoresEl.innerHTML = rankings.topConsumidores.map((item, idx) => `
                <tr>
                    <td><span class="badge badge-${idx === 0 ? 'warning' : idx === 1 ? 'info' : idx === 2 ? 'success' : 'secondary'}">#${idx + 1}</span></td>
                    <td><strong>${item.idPunto}</strong><br><small class="text-muted">${item.nombre}</small></td>
                    <td>${item.consumoTotal.toFixed(2)} kWh</td>
                    <td><span class="${item.eficiencia > 130 ? 'text-danger' : item.eficiencia > 110 ? 'text-warning' : 'text-success'}">${item.eficiencia}%</span></td>
                </tr>
            `).join('');
        }
    }

    // Top ineficientes
    if (topIneficientesEl) {
        if (rankings.topIneficientes.length === 0) {
            topIneficientesEl.innerHTML = '<tr><td colspan="4" class="text-center">No hay datos disponibles</td></tr>';
        } else {
            topIneficientesEl.innerHTML = rankings.topIneficientes.map((item, idx) => `
                <tr>
                    <td><span class="badge badge-danger">#${idx + 1}</span></td>
                    <td><strong>${item.idPunto}</strong><br><small class="text-muted">${item.nombre}</small></td>
                    <td class="text-danger">${item.eficiencia}%</td>
                    <td class="text-danger">+${item.excedente.toFixed(2)} kWh (${item.excedentePorcentual}%)</td>
                </tr>
            `).join('');
        }
    }

    // Anomalías
    if (anomaliasEl) {
        if (rankings.anomalias.length === 0) {
            anomaliasEl.innerHTML = '<tr><td colspan="5" class="text-center text-success"><i class="fas fa-check-circle"></i> No se detectaron anomalías</td></tr>';
        } else {
            anomaliasEl.innerHTML = rankings.anomalias.map(item => {
                const fecha = item.fecha ? formatearFecha(item.fecha.toDate ? item.fecha.toDate() : new Date(item.fecha)) : '';
                return `
                    <tr>
                        <td><strong>${item.idPunto}</strong><br><small>${item.nombre}</small></td>
                        <td class="text-danger">${item.consumo.toFixed(2)} kWh</td>
                        <td>${item.promedio.toFixed(2)} kWh</td>
                        <td><span class="badge badge-${item.severidad === 'alta' ? 'danger' : 'warning'}">${item.zScore}σ</span></td>
                        <td><small>${fecha}</small></td>
                    </tr>
                `;
            }).join('');
        }
    }
}

function actualizarTarjetasMetricas(metricas) {
    // Consumo total
    document.getElementById('consumo-total').textContent = metricas.consumoTotal.toFixed(2);
    
    // Consumo promedio
    document.getElementById('consumo-promedio').textContent = metricas.consumoPromedio.toFixed(2);
    
    // Puntos activos (de la colección puntos_monitoreo)
    const puntosActivosEl = document.getElementById('puntos-activos');
    if (puntosActivosEl) {
        puntosActivosEl.innerHTML = `${metricas.puntosActivos} <small class="text-muted">/ ${metricas.totalPuntos}</small>`;
    }
    
    // Lecturas hoy
    document.getElementById('lecturas-hoy').textContent = metricas.lecturasHoy;
    
    // Tendencia
    const tendenciaElement = document.getElementById('tendencia');
    if (tendenciaElement) {
        const tendenciaTexto = metricas.tendencia >= 0 
            ? `+${metricas.tendencia}%` 
            : `${metricas.tendencia}%`;
        tendenciaElement.textContent = tendenciaTexto;
        tendenciaElement.className = metricas.tendencia > 5 
            ? 'text-danger' 
            : metricas.tendencia < -5 
                ? 'text-success' 
                : 'text-warning';
    }
    
    // Indicador de horario pico
    const picoIndicator = document.getElementById('pico-indicator');
    if (picoIndicator) {
        if (metricas.esPico) {
            picoIndicator.innerHTML = '<span class="badge badge-warning"><i class="fas fa-bolt"></i> Horario Pico</span>';
        } else if (esFinDeSemana()) {
            picoIndicator.innerHTML = '<span class="badge badge-info"><i class="fas fa-calendar"></i> Fin de Semana</span>';
        } else {
            picoIndicator.innerHTML = '<span class="badge badge-success"><i class="fas fa-check"></i> Horario Normal</span>';
        }
    }
}

function actualizarTablaLecturas(lecturas) {
    const tbody = document.getElementById('tabla-lecturas');
    
    if (!tbody) return;
    
    if (lecturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-warning"><i class="fas fa-exclamation-triangle"></i> No hay datos disponibles</td></tr>';
        return;
    }
    
    const lecturasRecientes = lecturas.slice(0, 15);
    
    tbody.innerHTML = lecturasRecientes.map(lectura => {
        const fecha = lectura.fecha 
            ? formatearFecha(lectura.fecha.toDate ? lectura.fecha.toDate() : new Date(lectura.fecha)) 
            : 'N/A';
        
        // Determinar badge de estado
        let estadoBadge;
        switch (lectura.estado) {
            case 'activo':
                estadoBadge = '<span class="badge badge-success">Activo</span>';
                break;
            case 'inactivo':
                estadoBadge = '<span class="badge badge-secondary">Inactivo</span>';
                break;
            case 'error':
                estadoBadge = '<span class="badge badge-danger">Error</span>';
                break;
            default:
                estadoBadge = '<span class="badge badge-warning">Desconocido</span>';
        }
        
        // Calcular porcentaje sobre base
        const porcentajeBase = lectura.consumo_base > 0 
            ? ((lectura.consumo_kwh / lectura.consumo_base) * 100).toFixed(0)
            : 0;
        
        // Color según porcentaje
        let colorPorcentaje = 'text-success';
        if (porcentajeBase > 150) colorPorcentaje = 'text-danger';
        else if (porcentajeBase > 120) colorPorcentaje = 'text-warning';
        
        return `
            <tr>
                <td><strong>${lectura.id_punto}</strong><br><small class="text-muted">${lectura.nombre_punto}</small></td>
                <td>${lectura.consumo_kwh.toFixed(2)} kWh</td>
                <td><span class="${colorPorcentaje}">${porcentajeBase}%</span></td>
                <td>${estadoBadge}</td>
                <td><small>${fecha}</small></td>
            </tr>
        `;
    }).join('');
}

function actualizarMensajeVerde(metricas) {
    const mensajeElement = document.getElementById('mensaje-verde');
    if (!mensajeElement) return;
    
    let mensaje = "";
    let clase = "";
    
    // Lógica basada en tendencia y horario
    if (metricas.tendencia > 20) {
        mensaje = "🚨 <strong>Alerta Crítica:</strong> El consumo está aumentando significativamente. Revisa los equipos y considera medidas de ahorro inmediatas.";
        clase = "alert-danger";
    } else if (metricas.tendencia > 10 || (metricas.esPico && metricas.consumoPromedio > 10)) {
        mensaje = "⚠️ <strong>Atención:</strong> Consumo elevado detectado. Recuerda apagar equipos no utilizados y optimizar el uso del aire acondicionado.";
        clase = "alert-warning";
    } else if (esFinDeSemana() && metricas.puntosActivos > 2) {
        mensaje = "📅 <strong>Fin de Semana:</strong> Hay puntos activos durante el fin de semana. Verifica que solo estén encendidos los equipos necesarios.";
        clase = "alert-info";
    } else if (metricas.tendencia < -5) {
        mensaje = "📉 <strong>Excelente:</strong> El consumo está disminuyendo. ¡Buen trabajo con el ahorro energético! 🌱";
        clase = "alert-success";
    } else {
        mensaje = "✅ <strong>Normal:</strong> El consumo energético está dentro de los parámetros esperados. ¡Sigue así! 🌍";
        clase = "alert-success";
    }
    
    mensajeElement.className = `alert ${clase}`;
    mensajeElement.innerHTML = mensaje;
}

// ============================================
// GRÁFICAS
// ============================================

function crearGraficaConsumo(lecturas) {
    const ctx = document.getElementById('grafica-consumo');
    if (!ctx) return;
    
    // Agrupar por punto
    const consumoPorPunto = {};
    lecturas.forEach(l => {
        if (l.estado === 'activo') {
            if (!consumoPorPunto[l.id_punto]) {
                consumoPorPunto[l.id_punto] = {
                    total: 0,
                    count: 0,
                    nombre: l.nombre_punto
                };
            }
            consumoPorPunto[l.id_punto].total += l.consumo_kwh;
            consumoPorPunto[l.id_punto].count++;
        }
    });
    
    const labels = Object.keys(consumoPorPunto);
    const datos = labels.map(id => (consumoPorPunto[id].total / consumoPorPunto[id].count).toFixed(2));
    
    // Colores según consumo
    const colores = datos.map(d => {
        if (d > 15) return 'rgba(231, 74, 59, 0.8)';  // Rojo
        if (d > 10) return 'rgba(246, 194, 62, 0.8)'; // Amarillo
        return 'rgba(28, 200, 138, 0.8)';             // Verde
    });
    
    if (consumoChart) consumoChart.destroy();
    
    consumoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Consumo Promedio (kWh)',
                data: datos,
                backgroundColor: colores,
                borderColor: colores.map(c => c.replace('0.8', '1')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Consumo Promedio por Punto de Monitoreo'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'kWh' }
                }
            }
        }
    });
}

function crearGraficaTendencia(lecturas) {
    const ctx = document.getElementById('grafica-tendencia');
    if (!ctx) return;

    // Agrupar por hora
    const consumoPorHora = {};
    lecturas.forEach(l => {
        if (l.estado === 'activo' && l.fecha) {
            const fecha = l.fecha.toDate ? l.fecha.toDate() : new Date(l.fecha);
            const hora = fecha.getHours();
            if (!consumoPorHora[hora]) {
                consumoPorHora[hora] = { total: 0, count: 0 };
            }
            consumoPorHora[hora].total += l.consumo_kwh;
            consumoPorHora[hora].count++;
        }
    });

    // Crear array de 24 horas
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const datos = labels.map((_, i) => {
        if (consumoPorHora[i] && consumoPorHora[i].count > 0) {
            return (consumoPorHora[i].total / consumoPorHora[i].count).toFixed(2);
        }
        return 0;
    });

    if (comparativoChart) comparativoChart.destroy();

    comparativoChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Consumo por Hora',
                data: datos,
                borderColor: 'rgba(28, 200, 138, 1)',
                backgroundColor: 'rgba(28, 200, 138, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Patrón de Consumo por Hora del Día'
                },
                annotation: {
                    annotations: {
                        picoManana: {
                            type: 'box',
                            xMin: 8,
                            xMax: 12,
                            backgroundColor: 'rgba(246, 194, 62, 0.1)',
                            borderColor: 'rgba(246, 194, 62, 0.5)'
                        },
                        picoTarde: {
                            type: 'box',
                            xMin: 14,
                            xMax: 18,
                            backgroundColor: 'rgba(246, 194, 62, 0.1)',
                            borderColor: 'rgba(246, 194, 62, 0.5)'
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'kWh Promedio' }
                }
            }
        }
    });
}

/**
 * Crea gráfico circular de distribución de consumo
 */
function crearGraficaDistribucion(lecturas) {
    const ctx = document.getElementById('grafica-distribucion');
    if (!ctx) return;

    // Agrupar consumo por punto
    const consumoPorPunto = {};
    let consumoTotal = 0;

    lecturas.forEach(l => {
        if (l.estado === 'activo') {
            if (!consumoPorPunto[l.id_punto]) {
                consumoPorPunto[l.id_punto] = { total: 0, nombre: l.nombre_punto };
            }
            consumoPorPunto[l.id_punto].total += l.consumo_kwh;
            consumoTotal += l.consumo_kwh;
        }
    });

    // Ordenar por consumo y tomar top 8 + otros
    const puntosOrdenados = Object.entries(consumoPorPunto)
        .sort((a, b) => b[1].total - a[1].total);

    const topPuntos = puntosOrdenados.slice(0, 8);
    const otros = puntosOrdenados.slice(8);

    const labels = topPuntos.map(([id, data]) => data.nombre || id);
    const datos = topPuntos.map(([id, data]) => data.total.toFixed(2));

    // Agregar "otros" si hay más de 8 puntos
    if (otros.length > 0) {
        labels.push('Otros');
        const totalOtros = otros.reduce((sum, [id, data]) => sum + data.total, 0);
        datos.push(totalOtros.toFixed(2));
    }

    // Colores para el gráfico
    const colores = [
        'rgba(231, 74, 59, 0.8)',
        'rgba(246, 194, 62, 0.8)',
        'rgba(28, 200, 138, 0.8)',
        'rgba(78, 115, 223, 0.8)',
        'rgba(54, 162, 235, 0.8)',
        'rgba(255, 99, 132, 0.8)',
        'rgba(75, 192, 192, 0.8)',
        'rgba(153, 102, 255, 0.8)',
        'rgba(201, 203, 207, 0.8)'
    ];

    if (distribucionChart) distribucionChart.destroy();

    distribucionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: datos,
                backgroundColor: colores.slice(0, datos.length),
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        generateLabels: function(chart) {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                                const total = data.datasets[0].data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                                return data.labels.map((label, i) => {
                                    const value = data.datasets[0].data[i];
                                    const porcentaje = ((value / total) * 100).toFixed(1);
                                    return {
                                        text: `${label}: ${porcentaje}%`,
                                        fillStyle: data.datasets[0].backgroundColor[i],
                                        hidden: false,
                                        index: i
                                    };
                                });
                            }
                            return [];
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                            const porcentaje = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} kWh (${porcentaje}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// SECCIÓN: PUNTOS DE MONITOREO
// ============================================

async function cargarPuntos() {
    const container = document.getElementById('puntos-container');
    if (!container) return;
    
    const puntos = datosGlobales.puntos;
    
    if (puntos.length === 0) {
        container.innerHTML = '<div class="col-12"><p class="text-center text-muted">No hay puntos de monitoreo configurados</p></div>';
        return;
    }
    
    // Obtener última lectura de cada punto
    const ultimasLecturas = {};
    datosGlobales.lecturas.forEach(l => {
        if (!ultimasLecturas[l.id_punto]) {
            ultimasLecturas[l.id_punto] = l;
        }
    });
    
    container.innerHTML = puntos.map(punto => {
        const ultimaLectura = ultimasLecturas[punto.id];
        const consumoActual = ultimaLectura ? ultimaLectura.consumo_kwh : 0;
        const estadoActual = ultimaLectura ? ultimaLectura.estado : 'sin datos';
        
        // Calcular porcentaje sobre base
        const porcentaje = punto.consumo_base_kwh > 0 
            ? ((consumoActual / punto.consumo_base_kwh) * 100).toFixed(0)
            : 0;
        
        // Determinar color de la tarjeta
        let colorBorde = 'border-left-success';
        let colorTexto = 'text-success';
        if (!punto.activo) {
            colorBorde = 'border-left-secondary';
            colorTexto = 'text-secondary';
        } else if (porcentaje > 150) {
            colorBorde = 'border-left-danger';
            colorTexto = 'text-danger';
        } else if (porcentaje > 120) {
            colorBorde = 'border-left-warning';
            colorTexto = 'text-warning';
        }
        
        // Badge de estado
        let estadoBadge = '';
        if (!punto.activo) {
            estadoBadge = '<span class="badge badge-secondary">Desactivado</span>';
        } else if (estadoActual === 'activo') {
            estadoBadge = '<span class="badge badge-success">En línea</span>';
        } else if (estadoActual === 'inactivo') {
            estadoBadge = '<span class="badge badge-warning">Inactivo</span>';
        } else {
            estadoBadge = '<span class="badge badge-info">Sin datos</span>';
        }
        
        return `
            <div class="col-xl-4 col-md-6 mb-4">
                <div class="card ${colorBorde} shadow h-100 punto-card">
                    <div class="card-body">
                        <div class="row no-gutters align-items-center">
                            <div class="col mr-2">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <div class="text-xs font-weight-bold ${colorTexto} text-uppercase">
                                        ${punto.id}
                                    </div>
                                    ${estadoBadge}
                                </div>
                                <div class="h5 mb-1 font-weight-bold text-gray-800">${punto.nombre}</div>
                                <div class="text-xs text-muted mb-2">
                                    <i class="fas fa-map-marker-alt"></i> ${punto.ubicacion}
                                </div>
                                <div class="row no-gutters mt-3">
                                    <div class="col-6">
                                        <div class="text-xs text-muted">Consumo Actual</div>
                                        <div class="font-weight-bold">${consumoActual.toFixed(2)} kWh</div>
                                    </div>
                                    <div class="col-6">
                                        <div class="text-xs text-muted">Base Esperado</div>
                                        <div class="font-weight-bold">${punto.consumo_base_kwh} kWh</div>
                                    </div>
                                </div>
                                <div class="progress mt-2" style="height: 8px;">
                                    <div class="progress-bar ${porcentaje > 150 ? 'bg-danger' : porcentaje > 120 ? 'bg-warning' : 'bg-success'}" 
                                         style="width: ${Math.min(porcentaje, 200)}%"></div>
                                </div>
                                <div class="text-xs text-right mt-1 ${colorTexto}">${porcentaje}% del base</div>
                            </div>
                            <div class="col-auto">
                                <i class="fas fa-bolt fa-2x text-gray-300"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// SECCIÓN: HISTÓRICO
// ============================================

async function cargarHistorico() {
    const fechaInicio = document.getElementById('fecha-inicio')?.value;
    const fechaFin = document.getElementById('fecha-fin')?.value;
    const puntoSeleccionado = document.getElementById('filtro-punto')?.value;
    
    let lecturas = datosGlobales.lecturas;
    
    // Filtrar por fechas si están definidas
    if (fechaInicio) {
        const inicio = new Date(fechaInicio);
        lecturas = lecturas.filter(l => {
            const fecha = l.fecha?.toDate ? l.fecha.toDate() : new Date(l.fecha);
            return fecha >= inicio;
        });
    }
    
    if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59);
        lecturas = lecturas.filter(l => {
            const fecha = l.fecha?.toDate ? l.fecha.toDate() : new Date(l.fecha);
            return fecha <= fin;
        });
    }
    
    // Filtrar por punto si está seleccionado
    if (puntoSeleccionado && puntoSeleccionado !== 'todos') {
        lecturas = lecturas.filter(l => l.id_punto === puntoSeleccionado);
    }
    
    crearGraficaHistorico(lecturas);
    actualizarTablaHistorico(lecturas);
}

function crearGraficaHistorico(lecturas) {
    const ctx = document.getElementById('grafica-historico');
    if (!ctx) return;
    
    // Agrupar por fecha
    const consumoPorDia = {};
    lecturas.forEach(l => {
        if (l.estado === 'activo' && l.fecha) {
            const fecha = l.fecha.toDate ? l.fecha.toDate() : new Date(l.fecha);
            const dia = fecha.toISOString().split('T')[0];
            if (!consumoPorDia[dia]) {
                consumoPorDia[dia] = { total: 0, count: 0 };
            }
            consumoPorDia[dia].total += l.consumo_kwh;
            consumoPorDia[dia].count++;
        }
    });
    
    const diasOrdenados = Object.keys(consumoPorDia).sort();
    const datos = diasOrdenados.map(dia => consumoPorDia[dia].total.toFixed(2));
    
    if (historicoChart) historicoChart.destroy();
    
    historicoChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: diasOrdenados.map(d => {
                const fecha = new Date(d);
                return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
            }),
            datasets: [{
                label: 'Consumo Total Diario (kWh)',
                data: datos,
                borderColor: 'rgba(78, 115, 223, 1)',
                backgroundColor: 'rgba(78, 115, 223, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Evolución del Consumo Energético'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'kWh Total' }
                }
            }
        }
    });
}

function actualizarTablaHistorico(lecturas) {
    const tbody = document.getElementById('tabla-historico');
    if (!tbody) return;
    
    // Agrupar por día y punto
    const resumenDiario = {};
    lecturas.forEach(l => {
        if (l.fecha) {
            const fecha = l.fecha.toDate ? l.fecha.toDate() : new Date(l.fecha);
            const dia = fecha.toISOString().split('T')[0];
            const key = `${dia}-${l.id_punto}`;
            
            if (!resumenDiario[key]) {
                resumenDiario[key] = {
                    dia,
                    punto: l.id_punto,
                    nombre: l.nombre_punto,
                    consumoTotal: 0,
                    lecturas: 0,
                    base: l.consumo_base
                };
            }
            resumenDiario[key].consumoTotal += l.consumo_kwh;
            resumenDiario[key].lecturas++;
        }
    });
    
    const filas = Object.values(resumenDiario)
        .sort((a, b) => b.dia.localeCompare(a.dia))
        .slice(0, 20);
    
    if (filas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay datos para el período seleccionado</td></tr>';
        return;
    }
    
    tbody.innerHTML = filas.map(fila => {
        const promedio = fila.consumoTotal / fila.lecturas;
        const porcentaje = ((promedio / fila.base) * 100).toFixed(0);
        
        return `
            <tr>
                <td>${new Date(fila.dia).toLocaleDateString('es-ES')}</td>
                <td><strong>${fila.punto}</strong><br><small>${fila.nombre}</small></td>
                <td>${fila.consumoTotal.toFixed(2)} kWh</td>
                <td>${promedio.toFixed(2)} kWh</td>
                <td><span class="${porcentaje > 130 ? 'text-danger' : porcentaje > 110 ? 'text-warning' : 'text-success'}">${porcentaje}%</span></td>
            </tr>
        `;
    }).join('');
}

// ============================================
// SISTEMA DE ALERTAS
// ============================================

async function generarAlertas() {
    const lecturas = datosGlobales.lecturas;
    const puntos = datosGlobales.puntos;
    const alertas = [];
    
    // Agrupar lecturas por punto (las más recientes primero)
    const lecturasPorPunto = {};
    lecturas.forEach(l => {
        if (!lecturasPorPunto[l.id_punto]) {
            lecturasPorPunto[l.id_punto] = [];
        }
        lecturasPorPunto[l.id_punto].push(l);
    });
    
    // Analizar cada punto
    Object.entries(lecturasPorPunto).forEach(([idPunto, lecs]) => {
        const punto = puntos.find(p => p.id === idPunto);
        if (!punto) return;
        
        const lecturaActual = lecs[0]; // La más reciente
        if (!lecturaActual) return;
        
        const consumoBase = punto.consumo_base_kwh;
        const consumoActual = lecturaActual.consumo_kwh;
        const ratio = consumoActual / consumoBase;
        
        // REGLA 1: Si el punto está marcado como inactivo pero tiene consumo
        if (!punto.activo && consumoActual > 0.5) {
            alertas.push({
                nivel: 'alta',
                punto: idPunto,
                nombre: punto.nombre,
                mensaje: `Punto desactivado con consumo detectado: ${consumoActual.toFixed(2)} kWh`,
                accion: 'Verificar si hay equipos encendidos que deberían estar apagados',
                fecha: lecturaActual.fecha
            });
        }
        
        // REGLA 2: Consumo crítico (>150% del base)
        if (ratio > CONFIG_ALERTAS.UMBRAL_CRITICO && punto.activo) {
            alertas.push({
                nivel: 'critica',
                punto: idPunto,
                nombre: punto.nombre,
                mensaje: `Consumo crítico: ${consumoActual.toFixed(2)} kWh (${(ratio * 100).toFixed(0)}% del base)`,
                accion: 'Revisar inmediatamente. Posible fuga o equipo defectuoso.',
                fecha: lecturaActual.fecha
            });
        }
        // REGLA 3: Consumo alto (>130% del base)
        else if (ratio > CONFIG_ALERTAS.UMBRAL_ALTO && punto.activo) {
            alertas.push({
                nivel: 'alta',
                punto: idPunto,
                nombre: punto.nombre,
                mensaje: `Consumo elevado: ${consumoActual.toFixed(2)} kWh (${(ratio * 100).toFixed(0)}% del base)`,
                accion: 'Considerar optimización de equipos',
                fecha: lecturaActual.fecha
            });
        }
        
        // REGLA 4: Consumo sostenido alto (últimas 5 lecturas)
        if (lecs.length >= 5 && punto.activo) {
            const promedio5 = lecs.slice(0, 5).reduce((s, l) => s + l.consumo_kwh, 0) / 5;
            if (promedio5 > consumoBase * CONFIG_ALERTAS.UMBRAL_MEDIO) {
                alertas.push({
                    nivel: 'media',
                    punto: idPunto,
                    nombre: punto.nombre,
                    mensaje: `Consumo sostenido elevado: ${promedio5.toFixed(2)} kWh promedio`,
                    accion: 'Revisar patrones de uso y políticas de ahorro',
                    fecha: lecturaActual.fecha
                });
            }
        }
        
        // REGLA 5: Consumo alto en fin de semana
        if (esFinDeSemana() && punto.activo) {
            const consumoEsperadoFinde = consumoBase * CONFIG_ALERTAS.FACTOR_FIN_SEMANA;
            if (consumoActual > consumoEsperadoFinde * 1.5) {
                alertas.push({
                    nivel: 'media',
                    punto: idPunto,
                    nombre: punto.nombre,
                    mensaje: `Consumo alto en fin de semana: ${consumoActual.toFixed(2)} kWh (esperado: ~${consumoEsperadoFinde.toFixed(2)} kWh)`,
                    accion: 'Verificar equipos que deberían estar apagados',
                    fecha: lecturaActual.fecha
                });
            }
        }
        
        // REGLA 6: Estado de error
        if (lecturaActual.estado === 'error') {
            alertas.push({
                nivel: 'alta',
                punto: idPunto,
                nombre: punto.nombre,
                mensaje: 'Error de comunicación con el sensor',
                accion: 'Verificar conexión del dispositivo IoT',
                fecha: lecturaActual.fecha
            });
        }
    });
    
    datosGlobales.alertas = alertas;
    
    // Actualizar contadores
    const criticas = alertas.filter(a => a.nivel === 'critica').length;
    const altas = alertas.filter(a => a.nivel === 'alta').length;
    const medias = alertas.filter(a => a.nivel === 'media').length;
    
    const elemCriticas = document.getElementById('alertas-criticas');
    const elemAltas = document.getElementById('alertas-altas');
    const elemMedias = document.getElementById('alertas-medias');
    const elemCounter = document.getElementById('alertas-counter');
    
    if (elemCriticas) elemCriticas.textContent = criticas;
    if (elemAltas) elemAltas.textContent = altas;
    if (elemMedias) elemMedias.textContent = medias;
    if (elemCounter) elemCounter.textContent = criticas + altas;
    
    // Mostrar lista de alertas
    mostrarListaAlertas(alertas);
}

function mostrarListaAlertas(alertas) {
    const listaAlertas = document.getElementById('alertas-lista');
    if (!listaAlertas) return;
    
    if (alertas.length === 0) {
        listaAlertas.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-check-circle fa-4x text-success mb-3"></i>
                <h5 class="text-success">¡Sistema Operando Normalmente!</h5>
                <p class="text-muted">No hay alertas activas en este momento</p>
            </div>
        `;
        return;
    }
    
    // Ordenar por nivel de gravedad
    const ordenNivel = { critica: 0, alta: 1, media: 2 };
    alertas.sort((a, b) => ordenNivel[a.nivel] - ordenNivel[b.nivel]);
    
    listaAlertas.innerHTML = alertas.map(alerta => {
        const claseAlerta = alerta.nivel === 'critica' ? 'alerta-critica' :
                           alerta.nivel === 'alta' ? 'alerta-alta' : 'alerta-media';
        const icono = alerta.nivel === 'critica' ? 'exclamation-circle' :
                     alerta.nivel === 'alta' ? 'exclamation-triangle' : 'info-circle';
        const colorIcono = alerta.nivel === 'critica' ? 'text-danger' :
                          alerta.nivel === 'alta' ? 'text-warning' : 'text-info';
        
        const fechaFormateada = alerta.fecha 
            ? formatearFecha(alerta.fecha.toDate ? alerta.fecha.toDate() : new Date(alerta.fecha))
            : '';
        
        return `
            <div class="card ${claseAlerta} alerta-card mb-3">
                <div class="card-body">
                    <div class="row">
                        <div class="col-auto">
                            <i class="fas fa-${icono} fa-2x ${colorIcono}"></i>
                        </div>
                        <div class="col">
                            <div class="d-flex justify-content-between">
                                <h6 class="font-weight-bold text-uppercase mb-1">
                                    ${alerta.nivel.toUpperCase()} - ${alerta.punto}
                                </h6>
                                <small class="text-muted">${fechaFormateada}</small>
                            </div>
                            <p class="text-muted small mb-1">${alerta.nombre}</p>
                            <p class="mb-1">${alerta.mensaje}</p>
                            <p class="mb-0 small">
                                <i class="fas fa-lightbulb text-warning"></i>
                                <strong>Acción:</strong> ${alerta.accion}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Exporta datos a CSV
 */
function exportarCSV(tipo = 'lecturas') {
    const lecturas = datosGlobales.lecturas;
    const puntos = datosGlobales.puntos;

    let csv = '';
    let filename = '';

    if (tipo === 'lecturas') {
        filename = `lecturas_${new Date().toISOString().split('T')[0]}.csv`;
        csv = 'Punto,Nombre Punto,Ubicación,Consumo kWh,Consumo Base kWh,Eficiencia %,Estado,Fecha\n';

        lecturas.forEach(l => {
            const punto = puntos.find(p => p.id === l.id_punto);
            const fecha = l.fecha ? (l.fecha.toDate ? l.fecha.toDate().toISOString() : l.fecha) : '';
            const eficiencia = l.consumo_base > 0 ? ((l.consumo_kwh / l.consumo_base) * 100).toFixed(1) : '0';
            csv += `"${l.id_punto}","${l.nombre_punto}","${punto?.ubicacion || ''}",${l.consumo_kwh},${l.consumo_base},${eficiencia},"${l.estado}","${fecha}"\n`;
        });
    } else if (tipo === 'kpis') {
        filename = `kpis_${new Date().toISOString().split('T')[0]}.csv`;
        const kpis = datosGlobales.kpis;
        csv = 'KPI,Valor\n';
        csv += `"Consumo Total kWh","${kpis.consumoTotal}"\n`;
        csv += `"Consumo Promedio kWh","${kpis.consumoPromedio}"\n`;
        csv += `"Eficiencia Global %","${kpis.eficienciaGlobal}"\n`;
        csv += `"Huella de Carbono kg","${kpis.huellaCarbono}"\n`;
        csv += `"Costo Estimado USD","${kpis.costoEstimado}"\n`;
        csv += `"Potencial Ahorro kWh","${kpis.potencialAhorro}"\n`;
        csv += `"Ahorro Porcentual %","${kpis.ahorroPorcentual}"\n`;
    } else if (tipo === 'eficiencia') {
        filename = `eficiencia_por_punto_${new Date().toISOString().split('T')[0]}.csv`;
        const eficienciaPorPunto = datosGlobales.kpis.eficienciaPorPunto || {};
        csv = 'ID Punto,Nombre,Eficiencia %,Consumo Promedio kWh,Consumo Base kWh,Lecturas\n';

        Object.entries(eficienciaPorPunto).forEach(([id, data]) => {
            csv += `"${id}","${data.nombre}",${data.eficiencia},${data.consumoPromedio},${data.consumoBase},${data.lecturas}\n`;
        });
    } else if (tipo === 'rankings') {
        filename = `rankings_${new Date().toISOString().split('T')[0]}.csv`;
        const rankings = datosGlobales.rankings;
        csv = 'Top Consumidores\n';
        csv += 'Rank,ID,Nombre,Consumo Total kWh,Eficiencia %\n';
        rankings.topConsumidores.forEach((item, idx) => {
            csv += `${idx + 1},"${item.idPunto}","${item.nombre}",${item.consumoTotal},${item.eficiencia}\n`;
        });
        csv += '\nTop Ineficientes\n';
        csv += 'Rank,ID,Nombre,Eficiencia %,Excedente kWh\n';
        rankings.topIneficientes.forEach((item, idx) => {
            csv += `${idx + 1},"${item.idPunto}","${item.nombre}",${item.eficiencia},${item.excedente}\n`;
        });
    }

    // Crear blob y descargar
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`📥 Archivo ${filename} exportado exitosamente`);
}

/**
 * Genera reporte de eficiencia
 */
function generarReporteEficiencia() {
    const kpis = datosGlobales.kpis;
    const rankings = datosGlobales.rankings;
    const proyecciones = datosGlobales.proyecciones;

    const reporte = `
╔═══════════════════════════════════════════════════════════════╗
║         REPORTE DE EFICIENCIA ENERGÉTICA - NUBE VERDE         ║
║                  ${new Date().toLocaleString('es-SV')}                   ║
╚═══════════════════════════════════════════════════════════════╝

📊 KPIs PRINCIPALES
────────────────────────────────────────────────────────────────
• Consumo Total: ${kpis.consumoTotal} kWh
• Consumo Promedio: ${kpis.consumoPromedio} kWh
• Eficiencia Global: ${kpis.eficienciaGlobal}% (${kpis.clasificacionEficiencia.texto})
• Huella de Carbono: ${kpis.huellaCarbono} kg CO₂
• Costo Estimado: $${kpis.costoEstimado} USD
• Potencial de Ahorro: ${kpis.potencialAhorro} kWh (${kpis.ahorroPorcentual}%)

📈 PROYECCIONES
────────────────────────────────────────────────────────────────
• Promedio Diario: ${proyecciones.promedioDiario} kWh
• Proyección Mensual: ${proyecciones.proyeccionMensual} kWh
• Costo Mensual Proyectado: $${proyecciones.costoMensualProyectado} USD
• Tendencia: ${proyecciones.tendencia} (${proyecciones.tasaCrecimiento}%)

🏆 TOP 5 CONSUMIDORES
────────────────────────────────────────────────────────────────
${rankings.topConsumidores.map((item, idx) => `${idx + 1}. ${item.idPunto} - ${item.nombre}: ${item.consumoTotal} kWh (${item.eficiencia}%)`).join('\n')}

⚠️ TOP 5 INEFICIENTES
────────────────────────────────────────────────────────────────
${rankings.topIneficientes.map((item, idx) => `${idx + 1}. ${item.idPunto} - ${item.nombre}: ${item.eficiencia}% (+${item.excedente} kWh)`).join('\n')}

🔍 ANOMALÍAS DETECTADAS: ${rankings.anomalias.length}
────────────────────────────────────────────────────────────────
${rankings.anomalias.length > 0 ? rankings.anomalias.map(a => `• ${a.idPunto}: ${a.consumo} kWh (${a.zScore}σ)`).join('\n') : 'No se detectaron anomalías'}

💡 RECOMENDACIONES
────────────────────────────────────────────────────────────────
${kpis.eficienciaGlobal > 110 ? '⚠️ La eficiencia energética está por encima del 110%. Se recomienda revisar los equipos de mayor consumo.' : '✅ La eficiencia energética está dentro de los parámetros normales.'}
${kpis.ahorroPorcentual > 15 ? '💰 Hay un potencial de ahorro significativo. Considera optimizar el uso de equipos.' : ''}
${rankings.anomalias.length > 3 ? '🚨 Se detectaron múltiples anomalías. Revisa los equipos que muestran picos inusuales de consumo.' : ''}

═══════════════════════════════════════════════════════════════
Generado por Nube Verde - Monitor de Consumo Energético
═══════════════════════════════════════════════════════════════
`;

    // Crear blob y descargar como archivo de texto
    const blob = new Blob([reporte], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_eficiencia_${new Date().toISOString().split('T')[0]}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('📄 Reporte de eficiencia generado exitosamente');
}

/**
 * Muestra detalles de un punto específico
 */
function mostrarDetallesPunto(idPunto) {
    const punto = datosGlobales.puntos.find(p => p.id === idPunto);
    if (!punto) return;

    // Obtener lecturas del punto
    const lecturasPunto = datosGlobales.lecturas.filter(l => l.id_punto === idPunto);

    if (lecturasPunto.length === 0) {
        alert(`No hay lecturas disponibles para ${punto.nombre}`);
        return;
    }

    const consumoTotal = lecturasPunto.reduce((s, l) => s + l.consumo_kwh, 0);
    const consumoPromedio = consumoTotal / lecturasPunto.length;
    const eficiencia = (consumoPromedio / punto.consumo_base_kwh) * 100;

    const detalles = `
📍 DETALLES DEL PUNTO: ${punto.nombre}
══════════════════════════════════════
ID: ${punto.id}
Ubicación: ${punto.ubicacion}
Estado: ${punto.activo ? 'Activo' : 'Inactivo'}

📊 CONSUMO
────────────────────────────────
Base Esperado: ${punto.consumo_base_kwh} kWh
Potencia Base: ${punto.potencia_base_w} W
Consumo Total: ${consumoTotal.toFixed(2)} kWh
Consumo Promedio: ${consumoPromedio.toFixed(2)} kWh
Eficiencia: ${eficiencia.toFixed(1)}%
Lecturas: ${lecturasPunto.length}

💰 COSTOS Y IMPACTO
────────────────────────────────
Costo Estimado: $${(consumoTotal * CONFIG_KPI.TARIFA_PROMEDIO).toFixed(2)} USD
Huella de Carbono: ${(consumoTotal * CONFIG_KPI.FACTOR_CO2).toFixed(2)} kg CO₂
    `;

    alert(detalles);
}

/**
 * Función auxiliar existente
 */
function formatearFecha(fecha) {
    if (!fecha) return 'N/A';
    return fecha.toLocaleString('es-SV', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function mostrarError(mensaje) {
    const statusElement = document.getElementById('conexion-status');
    if (statusElement) {
        statusElement.innerHTML = `<i class="fas fa-circle"></i> ${mensaje || 'Error'}`;
        statusElement.classList.remove('badge-success');
        statusElement.classList.add('badge-danger');
    }
}

function mostrarConectado() {
    const statusElement = document.getElementById('conexion-status');
    if (statusElement) {
        statusElement.innerHTML = '<i class="fas fa-circle"></i> Conectado';
        statusElement.classList.remove('badge-danger');
        statusElement.classList.add('badge-success');
    }
}

// ============================================
// FUNCIÓN PRINCIPAL DE ACTUALIZACIÓN
// ============================================

async function actualizarDashboard() {
    console.log("🔄 Actualizando dashboard...");

    try {
        // Obtener lecturas
        const lecturas = await obtenerLecturas();

        if (lecturas.length === 0) {
            console.warn("⚠️ No hay lecturas disponibles");
            return;
        }

        // Calcular métricas básicas
        const metricas = calcularMetricas(lecturas);
        console.log("📊 Métricas básicas:", metricas);

        // Calcular KPIs avanzados
        const kpis = calcularKPIsAvanzados(lecturas);
        datosGlobales.kpis = kpis;
        console.log("📈 KPIs avanzados:", kpis);

        // Calcular rankings
        const rankings = calcularRankings(lecturas);
        datosGlobales.rankings = rankings;
        console.log("🏆 Rankings:", rankings);

        // Calcular proyecciones
        const proyecciones = calcularProyecciones(lecturas);
        datosGlobales.proyecciones = proyecciones;
        console.log("📉 Proyecciones:", proyecciones);

        // Actualizar UI básica
        actualizarTarjetasMetricas(metricas);
        actualizarTablaLecturas(lecturas);
        actualizarMensajeVerde(metricas);

        // Actualizar nuevos KPIs
        actualizarTarjetasKPIs(kpis);
        actualizarPanelProyecciones(proyecciones);
        actualizarTablaRankings(rankings);

        // Actualizar gráficas
        crearGraficaConsumo(lecturas);
        crearGraficaTendencia(lecturas);
        crearGraficaDistribucion(lecturas);

        // Generar alertas
        if (datosGlobales.puntos.length > 0) {
            await generarAlertas();
        }

        mostrarConectado();
        console.log("✅ Dashboard actualizado con todos los KPIs");

    } catch (error) {
        console.error("❌ Error al actualizar dashboard:", error);
        mostrarError("Error de conexión");
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================

async function inicializarDashboard() {
    console.log("🚀 Inicializando Nube Verde...");
    
    try {
        // Cargar puntos primero (necesarios para calcular métricas)
        await obtenerPuntos();
        
        // Poblar selector de puntos en histórico
        poblarSelectorPuntos();
        
        // Cargar dashboard
        await actualizarDashboard();
        
        // Escuchar cambios en tiempo real
        escucharCambiosRealTime();
        
        // Actualizar cada 30 segundos como backup
        setInterval(actualizarDashboard, 30000);
        
    } catch (error) {
        console.error("❌ Error al inicializar:", error);
        mostrarError("Error al inicializar");
    }
}

function poblarSelectorPuntos() {
    const selector = document.getElementById('filtro-punto');
    if (!selector) return;
    
    selector.innerHTML = '<option value="todos">Todos los puntos</option>';
    
    datosGlobales.puntos.forEach(punto => {
        selector.innerHTML += `<option value="${punto.id}">${punto.id} - ${punto.nombre}</option>`;
    });
}

// Hacer funciones disponibles globalmente
window.actualizarDatos = actualizarDashboard;
window.mostrarSeccion = mostrarSeccion;
window.cargarPuntos = cargarPuntos;
window.cargarHistorico = cargarHistorico;
window.generarAlertas = generarAlertas;
window.cerrarSesion = cerrarSesion;
window.exportarCSV = exportarCSV;
window.generarReporteEficiencia = generarReporteEficiencia;
window.mostrarDetallesPunto = mostrarDetallesPunto;
