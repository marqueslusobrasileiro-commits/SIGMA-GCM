import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
  BookOpen, 
  Target, 
  Workflow, 
  CheckCircle2, 
  Download, 
  Share2, 
  ArrowRight,
  MapPin,
  QrCode,
  Clock,
  FileText,
  Monitor,
  ChevronRight
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';

interface SystemManualProps {
  onClose: () => void;
}

export const SystemManual: React.FC<SystemManualProps> = ({ onClose }) => {
  const manualRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownloadPDF = async () => {
    if (!manualRef.current || isDownloading) return;
    setIsDownloading(true);

    try {
      const element = manualRef.current;
      
      // Ensure container is at top for better capture
      const container = element.parentElement;
      const originalScrollTop = container ? container.scrollTop : 0;
      if (container) container.scrollTop = 0;

      // Small delay to ensure layout is stable and images are ready
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(element, {
        scale: 1.5, // Balanced quality and stability
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: true, // Enable logging for easier debugging in browser console
        windowWidth: 1200,
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById('manual-content');
          if (clonedElement) {
            // Force a consistent layout for the PDF capture
            clonedElement.style.width = '1000px';
            clonedElement.style.height = 'auto';
            clonedElement.style.maxHeight = 'none';
            clonedElement.style.overflow = 'visible';
            clonedElement.style.padding = '40px';
            clonedElement.style.margin = '0';
            clonedElement.style.borderRadius = '0'; // Remove rounded corners for PDF
            clonedElement.style.boxShadow = 'none'; // Remove shadow for PDF
            
            // Final safety check for any remaining oklch/modern colors
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach((el) => {
              const element = el as HTMLElement;
              const style = window.getComputedStyle(element);
              
              // Iterate over all computed style properties to catch any modern color functions
              // html2canvas fails when it encounters oklch, oklab, etc.
              for (let i = 0; i < style.length; i++) {
                const prop = style[i];
                const value = style.getPropertyValue(prop);
                
                if (value && (
                  value.includes('oklch') || 
                  value.includes('oklab') ||
                  value.includes('lab(') || 
                  value.includes('lch(') || 
                  value.includes('display-p3') ||
                  value.includes('color(') ||
                  value.includes('color-mix')
                )) {
                  // Map specific classes to safe hex colors first for accuracy
                  if (element.classList.contains('bg-blue-900')) element.style.backgroundColor = '#0f2c63';
                  else if (element.classList.contains('bg-blue-950')) element.style.backgroundColor = '#081a3a';
                  else if (element.classList.contains('text-blue-900')) element.style.color = '#0f2c63';
                  else if (element.classList.contains('bg-blue-500')) element.style.backgroundColor = '#266abf';
                  else if (element.classList.contains('bg-indigo-500')) element.style.backgroundColor = '#6366f1';
                  else if (element.classList.contains('bg-emerald-500')) element.style.backgroundColor = '#10b981';
                  else if (element.classList.contains('bg-amber-500')) element.style.backgroundColor = '#f59e0b';
                  else if (element.classList.contains('bg-green-500')) element.style.backgroundColor = '#24ab4a';
                  else if (element.classList.contains('bg-slate-700')) element.style.backgroundColor = '#334155';
                  else if (element.classList.contains('bg-slate-900')) element.style.backgroundColor = '#0f172a';
                  else if (element.classList.contains('bg-green-600')) element.style.backgroundColor = '#1e8e3e';
                  else if (element.classList.contains('bg-red-600')) element.style.backgroundColor = '#d93025';
                  else if (element.classList.contains('bg-yellow-500')) element.style.backgroundColor = '#f9ab00';
                  else if (element.classList.contains('bg-blue-50')) element.style.backgroundColor = '#f0f6fe';
                  else if (element.classList.contains('bg-slate-50')) element.style.backgroundColor = '#f8fafc';
                  else if (element.classList.contains('bg-slate-100')) element.style.backgroundColor = '#f1f5f9';
                  
                  // Generic fallbacks for any other property
                  if (prop.includes('background')) {
                    element.style.setProperty(prop, '#ffffff', 'important');
                  } else if (prop.includes('color')) {
                    element.style.setProperty(prop, '#000000', 'important');
                  } else if (prop.includes('border')) {
                    element.style.setProperty(prop, '#e2e8f0', 'important');
                  } else if (prop.includes('shadow')) {
                    element.style.setProperty(prop, 'none', 'important');
                  } else {
                    element.style.setProperty(prop, 'inherit', 'important');
                  }
                }
              }
            });

            // Remove backdrop filters which break html2canvas
            const blurs = clonedElement.querySelectorAll('.backdrop-blur-md, .backdrop-blur-\\[2px\\]');
            blurs.forEach((el) => {
              const style = (el as HTMLElement).style as any;
              style.backdropFilter = 'none';
              style.webkitBackdropFilter = 'none';
              if (el.classList.contains('bg-blue-900/40')) {
                (el as HTMLElement).style.backgroundColor = 'rgba(15, 44, 99, 0.6)';
              }
            });
          }
        }
      });
      
      // Restore scroll position
      if (container) container.scrollTop = originalScrollTop;

      if (!canvas) throw new Error('O navegador não conseguiu gerar a imagem do manual.');

      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      if (!imgData || imgData === 'data:,') throw new Error('A imagem gerada está vazia ou corrompida.');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgProps = pdf.getImageProperties(imgData);
      const margin = 10;
      const effectiveWidth = pdfWidth - (margin * 2);
      const contentHeight = (imgProps.height * effectiveWidth) / imgProps.width;
      
      let heightLeft = contentHeight;
      let position = margin;
      let pageNum = 1;

      // Add first page
      pdf.addImage(imgData, 'JPEG', margin, position, effectiveWidth, contentHeight);
      
      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`SIGMA-GCM - Manual Operacional | Página ${pageNum}`, margin, pdfHeight - 5);

      heightLeft -= (pdfHeight - margin * 2);

      while (heightLeft > 0) {
        pageNum++;
        position = margin - (pageNum - 1) * (pdfHeight - margin * 2);
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', margin, position, effectiveWidth, contentHeight);
        
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`SIGMA-GCM - Manual Operacional | Página ${pageNum}`, margin, pdfHeight - 5);
        
        heightLeft -= (pdfHeight - margin * 2);
      }

      const dateStr = new Date().toISOString().split('T')[0];
      pdf.save(`SIGMA-GCM_Manual_${dateStr}.pdf`);
    } catch (error) {
      console.error('Erro detalhado ao gerar PDF:', error);
      alert('Houve um erro ao processar o PDF. Tente fechar e abrir o manual novamente, ou aguarde alguns segundos para que todas as imagens carreguem.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Manual do Sistema SIGMA-GCM',
          text: 'Confira o manual de uso do sistema SIGMA-GCM.',
          url: window.location.href
        });
      } catch (error) {
        console.error('Erro ao compartilhar:', error);
      }
    } else {
      alert('O compartilhamento não é suportado neste navegador.');
    }
  };

  const steps = [
    {
      id: '01',
      title: 'PATRULHAMENTO',
      description: 'A viatura se desloca até o próprio público designado.',
      icon: MapPin,
      color: 'bg-blue-500'
    },
    {
      id: '02',
      title: 'LEITURA DO QR CODE',
      description: 'O agente realiza a leitura do QR Code fixado no local.',
      icon: QrCode,
      color: 'bg-indigo-500'
    },
    {
      id: '03',
      title: 'REGISTRO DA RONDA',
      description: 'O sistema salva automaticamente: Data, Hora, Localização GPS e Identificação do agente.',
      icon: Clock,
      color: 'bg-emerald-500'
    },
    {
      id: '04',
      title: 'OBSERVAÇÕES',
      description: 'O agente insere informações complementares e pode anexar imagens.',
      icon: FileText,
      color: 'bg-amber-500'
    },
    {
      id: '05',
      title: 'RELATÓRIO FINAL',
      description: 'O sistema gera relatório em PDF com todas as informações registradas.',
      icon: CheckCircle2,
      color: 'bg-green-500'
    },
    {
      id: '06',
      title: 'CENTRAL DE MONITORAMENTO',
      description: 'Os dados ficam disponíveis em tempo real para acompanhamento da central.',
      icon: Monitor,
      color: 'bg-slate-700'
    }
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-[2000] flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-white/10 flex items-center justify-between bg-blue-900 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-xl">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Manual do Sistema</h2>
            <p className="text-blue-200 text-xs uppercase tracking-widest font-bold">SIGMA-GCM v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleShare}
            className="text-white hover:bg-white/10"
          >
            <Share2 className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="text-white hover:bg-white/10 disabled:opacity-50"
          >
            {isDownloading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose}
            className="text-white hover:bg-white/10"
          >
            Fechar
          </Button>
        </div>
      </div>

      {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div 
          ref={manualRef} 
          id="manual-content"
          className="max-w-4xl mx-auto bg-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden text-slate-800"
        >
          {/* Cover / Intro */}
          <div className="bg-blue-900 p-6 sm:p-12 text-center text-white relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
              <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
            </div>
            <Shield className="w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 text-blue-400" />
            <h1 className="text-3xl sm:text-4xl font-black mb-3 sm:mb-4 tracking-tight">SIGMA-GCM</h1>
            <p className="text-base sm:text-xl text-blue-200 font-medium max-w-2xl mx-auto">
              Manual de Uso Institucional, Técnico e Operacional
            </p>
            <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full text-xs font-bold uppercase tracking-widest">
              Versão 1.0.0 • 2026
            </div>
          </div>

          <div className="p-5 sm:p-16 space-y-12 sm:space-y-20">
            {/* 1. Apresentação */}
            <section className="space-y-8">
              <div className="flex items-center gap-5 text-blue-900">
                <div className="p-4 bg-blue-50 rounded-2xl shadow-sm">
                  <Shield className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tight">01. Apresentação</h2>
                  <div className="h-1 w-20 bg-blue-900 mt-1 rounded-full" />
                </div>
              </div>
              <div className="bg-slate-50 p-5 sm:p-10 rounded-3xl sm:rounded-[2.5rem] border border-slate-100 leading-relaxed text-base sm:text-xl text-slate-700 shadow-inner">
                O <span className="font-bold text-blue-900">SIGMA-GCM</span> (Sistema Integrado de Gestão e Monitoramento de Atividades) é a ferramenta oficial de patrulhamento da Guarda Civil Municipal. Desenvolvido para maximizar a eficiência operacional, o sistema integra geolocalização em tempo real, auditoria de rondas via QR Code e gestão centralizada de ocorrências.
              </div>
            </section>

            {/* 2. Finalidade */}
            <section className="space-y-8">
              <div className="flex items-center gap-5 text-blue-900">
                <div className="p-4 bg-blue-50 rounded-2xl shadow-sm">
                  <Target className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tight">02. Finalidade</h2>
                  <div className="h-1 w-20 bg-blue-900 mt-1 rounded-full" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-6">
                {[
                  { text: 'Rastreabilidade Total', desc: 'Controle absoluto de trajetos e horários de patrulha.' },
                  { text: 'Validação Digital', desc: 'Confirmação de presença via leitura de QR Code criptografado.' },
                  { text: 'Auditoria em Tempo Real', desc: 'Acompanhamento instantâneo pela central de comando.' },
                  { text: 'Relatórios Oficiais', desc: 'Geração automática de documentos para fins jurídicos e administrativos.' },
                  { text: 'Gestão de Ocorrências', desc: 'Registro fotográfico e descritivo de incidentes no local.' }
                ].map((item, i) => (
                  <div key={i} className="flex flex-col gap-3 p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-all">
                    <div className="w-10 h-10 bg-blue-100 text-blue-900 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-blue-900 text-lg">{item.text}</h4>
                      <p className="text-sm text-slate-500 leading-snug">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Fluxo Operacional */}
            <section className="space-y-10">
              <div className="flex items-center gap-5 text-blue-900">
                <div className="p-4 bg-blue-50 rounded-2xl shadow-sm">
                  <Workflow className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tight">03. Fluxo Operacional</h2>
                  <div className="h-1 w-20 bg-blue-900 mt-1 rounded-full" />
                </div>
              </div>
              
              <div className="relative space-y-6">
                {/* Vertical Line for timeline */}
                <div className="absolute left-6 top-10 bottom-10 w-1 bg-slate-100 rounded-full hidden sm:block" />
                
                {steps.map((step, i) => (
                  <div key={i} className="flex flex-col sm:flex-row gap-6 group relative z-10">
                    <div className="flex flex-row sm:flex-col items-center">
                      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-xl transition-transform group-hover:scale-110", step.color)}>
                        <step.icon className="w-7 h-7" />
                      </div>
                    </div>
                    <div className="flex-1 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm group-hover:border-blue-200 transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest">Passo {step.id}</span>
                        <h3 className="text-xl font-black text-slate-900">
                          {step.title}
                        </h3>
                      </div>
                      <p className="text-slate-600 leading-relaxed text-lg">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. Imagem da Fluxologia */}
            <section className="space-y-8">
              <div className="flex items-center gap-5 text-blue-900">
                <div className="p-4 bg-blue-50 rounded-2xl shadow-sm">
                  <Monitor className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tight">04. Fluxologia Ilustrada</h2>
                  <div className="h-1 w-20 bg-blue-900 mt-1 rounded-full" />
                </div>
              </div>
              <div className="bg-slate-900 rounded-[3rem] p-6 sm:p-10 shadow-2xl overflow-hidden group border-4 border-white">
                <div className="relative overflow-hidden rounded-[2rem]">
                  <img 
                    src="https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&q=80&w=2000" 
                    alt="Fluxo Operacional do Sistema" 
                    className="w-full h-[400px] object-cover transform transition-transform duration-1000 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center bg-blue-900/50 backdrop-blur-[1px]">
                    <div className="p-6 bg-white/10 rounded-full mb-6 backdrop-blur-xl border border-white/20">
                      <Shield className="w-20 h-20 text-white drop-shadow-2xl" />
                    </div>
                    <h3 className="text-4xl font-black text-white mb-4 drop-shadow-2xl tracking-tighter">CICLO OPERACIONAL</h3>
                    <div className="flex items-center gap-4">
                      <div className="h-px w-12 bg-white/50" />
                      <p className="text-white font-black text-lg uppercase tracking-[0.3em] drop-shadow-lg">SIGMA-GCM</p>
                      <div className="h-px w-12 bg-white/50" />
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-center text-slate-400 text-sm font-medium italic">
                * Diagrama técnico representando o ecossistema de monitoramento e resposta rápida.
              </p>
            </section>

            {/* Footer Manual */}
            <div className="pt-16 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-8 text-slate-400 text-sm font-bold">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <Shield className="w-5 h-5 text-blue-900/40" />
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-900 uppercase tracking-tighter">SIGMA-GCM</span>
                  <span className="text-[10px] uppercase tracking-[0.2em]">Comando da Guarda Civil Municipal</span>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-slate-500">Versão 1.0.0</span>
                  <span className="text-[10px] uppercase tracking-widest">{new Date().getFullYear()} • Documento Oficial</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
