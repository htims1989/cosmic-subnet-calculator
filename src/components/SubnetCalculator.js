import React, { useState, useEffect, useRef, useCallback } from 'react';
import _ from 'lodash';

// Function to validate CIDR
const validateCIDR = (cidr) => {
  // Basic CIDR validation regex
  const cidrRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}\/([0-9]|[1-2][0-9]|3[0-2])$/;
  if (!cidrRegex.test(cidr)) return false;
  
  // Validate IP portion
  const ipPart = cidr.split('/')[0];
  const octets = ipPart.split('.');
  
  for (const octet of octets) {
    const num = parseInt(octet, 10);
    if (num < 0 || num > 255) return false;
  }
  
  // Validate prefix length
  const prefix = parseInt(cidr.split('/')[1], 10);
  if (prefix < 0 || prefix > 32) return false;
  
  // Additional constraint: max /16
  if (prefix < 16) return false;
  
  return true;
};

// Function to convert CIDR to IP range
const cidrToRange = (cidr) => {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  
  // Convert IP to integer
  const octets = ip.split('.');
  let ipInt = 0;
  for (let i = 0; i < 4; i++) {
    ipInt += parseInt(octets[i], 10) * Math.pow(256, 3 - i);
  }
  
  // Calculate range
  const maskBits = 32 - prefix;
  const subnetSize = Math.pow(2, maskBits);
  
  return {
    start: ipInt,
    end: ipInt + subnetSize - 1,
    size: subnetSize
  };
};

// Function to convert IP integer to dotted decimal
const intToIp = (ipInt) => {
  return [
    (ipInt >>> 24) & 255,
    (ipInt >>> 16) & 255,
    (ipInt >>> 8) & 255,
    ipInt & 255
  ].join('.');
};

// Function to check if a position is valid for the subnet
const isValidPosition = (relativePosition, baseSize, subnetPrefix) => {
  if (typeof relativePosition !== 'number' || typeof baseSize !== 'number' || typeof subnetPrefix !== 'number') {
    // Invalid parameters check
    return false;
  }
  
  // The position must align with the subnet boundaries
  const subnetSize = Math.pow(2, 32 - subnetPrefix);
  const positionAlignment = relativePosition % subnetSize;
  

  return positionAlignment === 0;
};

// Function to check if subnets overlap
const checkOverlap = (newSubnet, existingSubnets, excludeIndex = -1) => {
  for (let i = 0; i < existingSubnets.length; i++) {
    // Skip the subnet we're currently moving (if applicable)
    if (i === excludeIndex) continue;
    
    const subnet = existingSubnets[i];
    
    // If the new subnet's start is within an existing subnet's range
    if (newSubnet.start >= subnet.start && newSubnet.start <= subnet.end) {
      return true;
    }
    // If the new subnet's end is within an existing subnet's range
    if (newSubnet.end >= subnet.start && newSubnet.end <= subnet.end) {
      return true;
    }
    // If the new subnet completely contains an existing subnet
    if (newSubnet.start <= subnet.start && newSubnet.end >= subnet.end) {
      return true;
    }
  }
  return false;
};

// Function to generate available subnet sizes
const generateSubnetSizes = (cidr) => {
  const [, prefixStr] = cidr.split('/');
  const basePrefix = parseInt(prefixStr, 10);
  
  const sizes = [];
  // Generate subnet sizes from basePrefix+1 to /28 (smallest AWS-supported subnet)
  for (let prefix = basePrefix + 1; prefix <= 28; prefix++) {
    const maskBits = 32 - prefix;
    const subnetSize = Math.pow(2, maskBits);
    const hosts = subnetSize - 2; // Subtract network and broadcast addresses
    
    sizes.push({
      prefix,
      subnetSize,
      hosts,
      cidr: `/${prefix}`
    });
  }
  
  return sizes;
};

// Function to calculate position on the bar
const calculatePosition = (position, totalSize, barWidth) => {
  return (position / totalSize) * barWidth;
};

// Function to calculate width on the bar
const calculateWidth = (size, totalSize, barWidth) => {
  return (size / totalSize) * barWidth;
};

// Function to normalize CIDR (ensure it starts at a network boundary)
const normalizeCIDR = (cidr) => {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  
  // Convert IP to integer
  const octets = ip.split('.');
  let ipInt = 0;
  for (let i = 0; i < 4; i++) {
    ipInt += parseInt(octets[i], 10) * Math.pow(256, 3 - i);
  }
  
  // Apply network mask to get network address
  const maskBits = 32 - prefix;
  const mask = (1 << maskBits) - 1;
  const networkInt = ipInt & ~mask;
  
  // Convert back to CIDR notation
  const networkIp = intToIp(networkInt);
  return `${networkIp}/${prefix}`;
};

// Main Subnet Calculator component
const FixedSubnetCalculator = () => {
  const [cidr, setCidr] = useState('10.0.0.0/16');
  const [isValidInput, setIsValidInput] = useState(true);
  const [normalizedCidr, setNormalizedCidr] = useState('');
  const [baseRange, setBaseRange] = useState(null);
  const [availableSubnets, setAvailableSubnets] = useState([]);
  const [placedSubnets, setPlacedSubnets] = useState([]);
  const [barWidth, setBarWidth] = useState(800);
  const [draggedSubnet, setDraggedSubnet] = useState(null);
  const [selectedSubnet, setSelectedSubnet] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [validDropPositions, setValidDropPositions] = useState([]);
  const [movingSubnetIndex, setMovingSubnetIndex] = useState(-1);
  const [themePreference, setThemePreference] = useState('auto'); // 'auto', 'dark', or 'light'
  const [systemTheme, setSystemTheme] = useState('dark'); // Default to dark if cannot detect
  const cidrBarRef = useRef(null);

  // Select a subnet for placement (for click interaction)
  const handleSelectSubnet = (subnet, type) => {
    // If the same subnet is clicked again, deselect it
    if (selectedSubnet && 
      selectedSubnet.prefix === subnet.prefix && 
      selectedSubnet.type === type) {
      setSelectedSubnet(null);
      setValidDropPositions([]);
      return;
    }
    
    const subnetWithType = {
      ...subnet,
      type
    };
    
    setSelectedSubnet(subnetWithType);
    setDraggedSubnet(null); // Ensure no drag operation is active
    
    // The useEffect will handle calculating valid positions
  };

  // Handle click on CIDR bar for placing selected subnet
  const handleBarClick = (e) => {
    if (!selectedSubnet || !baseRange || !cidrBarRef.current) {
      return;
    }
    
    const barRect = cidrBarRef.current.getBoundingClientRect();
    const relativeX = e.clientX - barRect.left;
    
    // Calculate position within the CIDR range
    const positionPercentage = relativeX / barWidth;
    const position = Math.floor(baseRange.start + positionPercentage * baseRange.size);
    
    // Round to a valid subnet boundary
    const subnetSize = Math.pow(2, 32 - selectedSubnet.prefix);
    const alignedPosition = Math.floor(position / subnetSize) * subnetSize;
    
    // Check if the position is valid
    if (alignedPosition >= baseRange.start && alignedPosition + subnetSize <= baseRange.end + 1) {
      if (isValidPosition(alignedPosition - baseRange.start, baseRange.size, selectedSubnet.prefix)) {
        const newSubnet = {
          start: alignedPosition,
          end: alignedPosition + subnetSize - 1,
          size: subnetSize,
          prefix: selectedSubnet.prefix,
          baseStart: baseRange.start,
          type: selectedSubnet.type
        };
        
        // Check for overlaps
        if (!checkOverlap(newSubnet, placedSubnets)) {
          setPlacedSubnets([...placedSubnets, newSubnet]);
          
          // Option: keep the subnet selected for multiple placements
          // or clear selection after placing
          setSelectedSubnet(null);
          setValidDropPositions([]);
        }
      }
    }
  };

  // Change subnet type
  const handleChangeSubnetType = (index) => {
    // Cycle through types: public -> private -> database -> public
    const typeOrder = ['public', 'private', 'database'];
    const currentType = placedSubnets[index].type;
    const currentIndex = typeOrder.indexOf(currentType);
    const nextIndex = (currentIndex + 1) % typeOrder.length;
    const nextType = typeOrder[nextIndex];
    
    const newPlacedSubnets = [...placedSubnets];
    newPlacedSubnets[index] = {
      ...newPlacedSubnets[index],
      type: nextType
    };
    
    setPlacedSubnets(newPlacedSubnets);
  };

  // Handle global drag end (for drops outside the bar)
  const handleGlobalDragEnd = useCallback(() => {

    setDraggedSubnet(null);
    setDragPreview(null);
    setValidDropPositions([]);
    setMovingSubnetIndex(-1);
    // Remove the global event listener, though it should be automatic with { once: true }
    window.removeEventListener('dragend', handleGlobalDragEnd);
  }, []);
  
  // Handle global click to deselect
  const handleGlobalClick = useCallback((e) => {
    // Check if click is outside the subnet blocks and CIDR bar
    const isOutsideSubnetBlocks = !e.target.closest('.subnet-block');
    const isOutsideCidrBar = !e.target.closest('.cidr-bar');
    
    if (isOutsideSubnetBlocks && isOutsideCidrBar && selectedSubnet) {
      setSelectedSubnet(null);
      setValidDropPositions([]);
    }
  }, [selectedSubnet]);
  
  // Add global click handler to deselect subnet when clicking elsewhere
  useEffect(() => {
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [handleGlobalClick]);
  
  // Add a key press handler for escape key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && (draggedSubnet || selectedSubnet)) {

        handleGlobalDragEnd();
        setSelectedSubnet(null);
        setValidDropPositions([]);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draggedSubnet, selectedSubnet, handleGlobalDragEnd]);

  // Calculate valid drop positions for the current subnet being dragged
  const calculateValidDropPositions = useCallback((subnet) => {
    const activeSubnet = subnet || draggedSubnet || selectedSubnet;
    
    if (!activeSubnet) {

      return [];
    }
    
    if (!baseRange) {

      return [];
    }
    
    if (!barWidth) {

      return [];
    }
    

    
    const validPositions = [];
    const subnetSize = Math.pow(2, 32 - activeSubnet.prefix);
    

    
    // Iterate through all possible positions within the CIDR range
    let posCount = 0;
    for (let pos = baseRange.start; pos <= baseRange.end - subnetSize + 1; pos += subnetSize) {
      posCount++;
      const relativePosition = pos - baseRange.start;
      
      // Check if the position is valid
      const isValid = isValidPosition(relativePosition, baseRange.size, activeSubnet.prefix);
      
      if (isValid) {
        const newSubnet = {
          start: pos,
          end: pos + subnetSize - 1,
          size: subnetSize,
          prefix: activeSubnet.prefix,
          baseStart: baseRange.start,
          type: activeSubnet.type
        };
        
        // Check for overlaps (excluding the subnet being moved)
        const hasOverlap = checkOverlap(newSubnet, placedSubnets, movingSubnetIndex);
        
        if (!hasOverlap) {
          const left = calculatePosition(relativePosition, baseRange.size, barWidth);
          const width = calculateWidth(subnetSize, baseRange.size, barWidth);
          

          
          validPositions.push({
            left: left,
            width: width,
            subnet: newSubnet
          });
        }
      }
    }
    

    return validPositions;
  }, [draggedSubnet, selectedSubnet, baseRange, barWidth, placedSubnets, movingSubnetIndex]);

  // Effect to recalculate valid positions when draggedSubnet or selectedSubnet changes
  useEffect(() => {
    const activeSubnet = draggedSubnet || selectedSubnet;
    if (activeSubnet && baseRange) {
      const validPositions = calculateValidDropPositions(activeSubnet);
      setValidDropPositions(validPositions);
    } else if (!draggedSubnet && !selectedSubnet) {
      setValidDropPositions([]);
    }
  }, [draggedSubnet, selectedSubnet, baseRange, calculateValidDropPositions]);

  // Themes object
  const themes = {
    cosmic: {
      background: 'bg-slate-900',
      text: 'text-slate-200',
      highlight: 'bg-purple-900',
      panel: 'bg-slate-800',
      border: 'border-slate-700',
      input: 'bg-slate-700 border-slate-600',
      accent: 'text-purple-400',
      button: 'bg-indigo-600 hover:bg-indigo-700',
      buttonText: 'text-white',
      toggle: 'bg-slate-700',
      activeToggle: 'bg-indigo-600',
      moon: 'text-slate-300',
      sun: 'text-amber-300',
      auto: 'text-indigo-300',
      // Section headers for each subnet type
      publicHeader: 'text-indigo-300 font-medium',
      privateHeader: 'text-emerald-300 font-medium',
      databaseHeader: 'text-rose-300 font-medium',
      // IP labels and instructions
      ipLabels: 'text-indigo-300',
      instructions: 'text-gray-400',
      // Progress bar
      progressBar: 'bg-purple-600',
      progressBarBg: 'bg-gray-700',
      // Star colors for cosmic theme
      starBigBg: 'bg-yellow-200',
      starBigShadow: 'shadow-yellow-100',
      starMediumBg: 'bg-blue-400',
      starMediumShadow: 'shadow-blue-300',
      starSmallBg: 'bg-indigo-300',
      starSmallShadow: 'shadow-indigo-200',
      starTinyBg: 'bg-pink-400',
      starTinyShadow: 'shadow-pink-300'
    },
    cosmic_light: {
      background: 'bg-slate-100',
      text: 'text-slate-800',
      highlight: 'bg-indigo-100',
      panel: 'bg-white',
      border: 'border-slate-300',
      input: 'bg-slate-50 border-slate-300',
      accent: 'text-indigo-600',
      button: 'bg-indigo-500 hover:bg-indigo-600',
      buttonText: 'text-white',
      toggle: 'bg-slate-200',
      activeToggle: 'bg-indigo-500',
      moon: 'text-slate-600',
      sun: 'text-amber-500',
      auto: 'text-indigo-600',
      // Section headers for each subnet type with better contrast
      publicHeader: 'text-indigo-700 font-medium',
      privateHeader: 'text-emerald-700 font-medium',
      databaseHeader: 'text-rose-700 font-medium',
      // IP labels and instructions with better contrast
      ipLabels: 'text-indigo-700',
      instructions: 'text-slate-600',
      // Progress bar with less contrast
      progressBar: 'bg-indigo-400',
      progressBarBg: 'bg-gray-200',
      // Star colors for light theme
      starBigBg: 'bg-amber-400',
      starBigShadow: 'shadow-amber-300',
      starMediumBg: 'bg-blue-500',
      starMediumShadow: 'shadow-blue-400',
      starSmallBg: 'bg-violet-500',
      starSmallShadow: 'shadow-violet-400',
      starTinyBg: 'bg-rose-500',
      starTinyShadow: 'shadow-rose-400'
    }
  };
  
  // Detect system theme preference
  useEffect(() => {
    const detectSystemTheme = () => {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setSystemTheme('dark');
      } else {
        setSystemTheme('light');
      }
    };
    
    detectSystemTheme();
    
    // Listen for changes in system theme
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    
    // Add listener with compatibility for older browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange); // For older browsers
    }
    
    return () => {
      // Remove listener with compatibility for older browsers
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange); // For older browsers
      }
    };
  }, []);
  
  // Determine active theme based on preference and system setting
  const getActiveTheme = useCallback(() => {
    if (themePreference === 'auto') {
      return systemTheme === 'dark' ? themes.cosmic : themes.cosmic_light;
    } else if (themePreference === 'dark') {
      return themes.cosmic;
    } else {
      return themes.cosmic_light;
    }
  }, [themePreference, systemTheme]);
  
  const theme = getActiveTheme();

  // Initialize on component mount
  useEffect(() => {
    if (validateCIDR(cidr)) {
      const normalized = normalizeCIDR(cidr);
      setNormalizedCidr(normalized);
      
      const range = cidrToRange(normalized);

      setBaseRange({
        ...range,
        cidr: normalized
      });
      
      setAvailableSubnets(generateSubnetSizes(normalized));
    } else {

    }
    
    // Update bar width based on container size
    const updateBarWidth = () => {
      if (cidrBarRef.current) {
        const newWidth = cidrBarRef.current.offsetWidth;
        setBarWidth(newWidth);

      }
    };
    
    // Initial width update with a small delay to ensure DOM is ready
    setTimeout(updateBarWidth, 100);
    
    // Add resize listener
    window.addEventListener('resize', updateBarWidth);
    return () => window.removeEventListener('resize', updateBarWidth);
  }, [cidr]);

  // Handle CIDR input change
  const handleCidrChange = (e) => {
    const input = e.target.value;
    setCidr(input);
    
    const isValid = validateCIDR(input);
    setIsValidInput(isValid);
    
    if (isValid) {
      setPlacedSubnets([]);
    }
  };

  // Start dragging a new subnet from the available subnets panel
  const handleDragStart = (e, subnet, type) => {

    e.dataTransfer.setData('application/json', JSON.stringify({ subnet, type }));
    
    // Make a deep copy of the subnet and add the type
    const subnetWithType = {
      ...subnet,
      type
    };
    
    setDraggedSubnet(subnetWithType);
    setSelectedSubnet(null); // Clear any selection when dragging
    setMovingSubnetIndex(-1); // New subnet, not moving an existing one
    
    // The useEffect will handle calculating valid positions
    
    // Add a global event listener for dragend
    window.addEventListener('dragend', handleGlobalDragEnd, { once: true });
  };
  
  // Start dragging an existing subnet
  const handlePlacedSubnetDragStart = (e, subnet, index) => {
    e.stopPropagation();

    e.dataTransfer.setData('application/json', JSON.stringify({ subnet, index }));
    setDraggedSubnet(subnet);
    setSelectedSubnet(null); // Clear any selection when dragging
    setMovingSubnetIndex(index);
    
    // Create a ghost element for drag preview
    const ghostElement = document.createElement('div');
    ghostElement.style.width = '1px';
    ghostElement.style.height = '1px';
    ghostElement.style.position = 'absolute';
    ghostElement.style.top = '-100px';
    document.body.appendChild(ghostElement);
    e.dataTransfer.setDragImage(ghostElement, 0, 0);
    
    // The useEffect will handle calculating valid positions
    
    // Add a global event listener for dragend
    window.addEventListener('dragend', handleGlobalDragEnd, { once: true });
    
    // Remove the ghost element after a short delay
    setTimeout(() => {
      document.body.removeChild(ghostElement);
    }, 0);
  };

  // Handle drag over the CIDR bar
  const handleDragOver = (e) => {
    e.preventDefault();
    
    if (draggedSubnet && cidrBarRef.current && baseRange) {
      const barRect = cidrBarRef.current.getBoundingClientRect();
      const relativeX = e.clientX - barRect.left;
      
      // Calculate position within the CIDR range
      const positionPercentage = relativeX / barWidth;
      const position = Math.floor(baseRange.start + positionPercentage * baseRange.size);
      
      // Round to a valid subnet boundary
      const subnetSize = Math.pow(2, 32 - draggedSubnet.prefix);
      const alignedPosition = Math.floor(position / subnetSize) * subnetSize;
      
      // Only show preview for valid positions
      if (alignedPosition >= baseRange.start && alignedPosition + subnetSize <= baseRange.end + 1) {
        if (isValidPosition(alignedPosition - baseRange.start, baseRange.size, draggedSubnet.prefix)) {
          const newSubnet = {
            start: alignedPosition,
            end: alignedPosition + subnetSize - 1,
            size: subnetSize,
            prefix: draggedSubnet.prefix,
            baseStart: baseRange.start,
            type: draggedSubnet.type
          };
          
          // Check for overlaps (excluding the subnet being moved)
          if (!checkOverlap(newSubnet, placedSubnets, movingSubnetIndex)) {
            setDragPreview({
              left: calculatePosition(alignedPosition - baseRange.start, baseRange.size, barWidth),
              width: calculateWidth(subnetSize, baseRange.size, barWidth),
              subnet: newSubnet
            });
            return;
          }
        }
      }
      
      // If we get here, it's not a valid position
      setDragPreview(null);
    }
  };

  // Handle drop of subnet
  const handleDrop = (e) => {
    e.preventDefault();

    
    if (dragPreview && dragPreview.subnet) {
      if (movingSubnetIndex >= 0) {
        // Moving an existing subnet
        const newPlacedSubnets = [...placedSubnets];
        newPlacedSubnets[movingSubnetIndex] = {
          ...dragPreview.subnet,
          type: placedSubnets[movingSubnetIndex].type
        };
        setPlacedSubnets(newPlacedSubnets);
      } else {
        // Adding a new subnet
        setPlacedSubnets([...placedSubnets, dragPreview.subnet]);
      }
    }
    
    setDraggedSubnet(null);
    setDragPreview(null);
    setValidDropPositions([]);
    setMovingSubnetIndex(-1);
    
    // Clean up the global drag end handler
    window.removeEventListener('dragend', handleGlobalDragEnd);
  };

  // Handle drag leave
  const handleDragLeave = () => {
    setDragPreview(null);
  };
  
  // Handle drag end (for the bar element)
  const handleDragEnd = () => {
    setDraggedSubnet(null);
    setDragPreview(null);
    setValidDropPositions([]);
    setMovingSubnetIndex(-1);
  };

  // Remove a placed subnet
  const handleRemoveSubnet = (index) => {
    const newPlacedSubnets = [...placedSubnets];
    newPlacedSubnets.splice(index, 1);
    setPlacedSubnets(newPlacedSubnets);
  };

  // Calculate percentage of allocated IP space
  const calculateAllocatedPercentage = () => {
    if (!baseRange) return 0;
    
    const allocated = placedSubnets.reduce((sum, subnet) => sum + subnet.size, 0);
    return Math.round((allocated / baseRange.size) * 100);
  };

  // Render a subnet block for dragging or clicking
  const renderSubnetBlock = (subnet) => {
    // Default to public type for new subnets
    const colorClass = 'bg-indigo-500 border-indigo-600';
    const isSelected = selectedSubnet && selectedSubnet.prefix === subnet.prefix;
    
    return (
      <div
        key={`subnet-${subnet.prefix}`}
        draggable
        onDragStart={(e) => handleDragStart(e, subnet, 'public')}
        onClick={() => handleSelectSubnet(subnet, 'public')}
        className={`subnet-block p-2 rounded-md ${colorClass} text-white border shadow-lg flex flex-col justify-center cursor-pointer text-center
                    ${isSelected ? 'ring-2 ring-yellow-400 ring-opacity-100' : ''} 
                    transition-all hover:brightness-110`}
      >
        <div className="font-bold">{subnet.cidr}</div>
        <div className="text-xs">{subnet.hosts}</div>
        <div className="text-xs">hosts</div>
      </div>
    );
  };

  // Get ordered subnet numbers based on position from left to right
  const getOrderedSubnetNumbers = () => {
    if (!baseRange || !placedSubnets.length) return [];
    
    // Sort subnets by start position
    const sortedSubnets = [...placedSubnets].sort((a, b) => a.start - b.start);
    
    // Assign numbers 1 to n based on position
    const numberedSubnets = sortedSubnets.map((subnet, idx) => ({
      ...subnet,
      number: idx + 1
    }));
    
    // Create a mapping from original index to subnet number
    const indexToNumber = {};
    placedSubnets.forEach((subnet, originalIndex) => {
      const matchingSubnet = numberedSubnets.find(s => s.start === subnet.start && s.prefix === subnet.prefix);
      if (matchingSubnet) {
        indexToNumber[originalIndex] = matchingSubnet.number;
      }
    });
    
    return indexToNumber;
  };

  // Render placed subnet on the CIDR bar
  const renderPlacedSubnet = (subnet, index) => {
    const left = calculatePosition(subnet.start - subnet.baseStart, baseRange.size, barWidth);
    const width = calculateWidth(subnet.size, baseRange.size, barWidth);
    
    const colors = {
      public: 'bg-indigo-500 border-indigo-600',
      private: 'bg-emerald-500 border-emerald-600',
      database: 'bg-rose-500 border-rose-600'
    };
    
    const labelColors = {
      public: 'bg-indigo-700',
      private: 'bg-emerald-700',
      database: 'bg-rose-700'
    };
    
    const colorClass = colors[subnet.type] || colors.public;
    const labelColorClass = labelColors[subnet.type] || labelColors.public;
    
    // Get the subnet number from the ordering
    const subnetNumbers = getOrderedSubnetNumbers();
    const subnetNumber = subnetNumbers[index] || index + 1;
    
    return (
      <>
        <div 
          key={`block-${index}`}
          draggable
          onDragStart={(e) => handlePlacedSubnetDragStart(e, subnet, index)}
          className={`absolute ${colorClass} border rounded-md shadow-md flex flex-col items-center justify-center 
                    ${movingSubnetIndex === index ? 'opacity-50' : 'opacity-100'} 
                    cursor-grab`}
          style={{ 
            left: `${left}px`, 
            width: `${width}px`,
            height: '40px',
            top: 0
          }}
          onDoubleClick={() => handleRemoveSubnet(index)}
        >
          <div className="text-white text-md font-bold">
            {subnetNumber}
          </div>
        </div>
        
        {/* Separate label element below the bar */}
        <div 
          key={`label-${index}`}
          className={`absolute px-2 py-1 rounded ${labelColorClass} text-white text-xs shadow-md`}
          style={{
            left: left + width/2,
            top: '55px',
            transform: 'translateX(-50%)',
            zIndex: 20
          }}
        >
          {intToIp(subnet.start)}/{subnet.prefix} ({subnet.size.toLocaleString()} IPs)
        </div>
      </>
    );
  };

  // Theme toggle handler
  const handleThemeToggle = (newTheme) => {
    setThemePreference(newTheme);
    // Save preference to localStorage for persistence
    localStorage.setItem('themePreference', newTheme);
  };
  
  // Load saved theme preference on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('themePreference');
    if (savedTheme) {
      setThemePreference(savedTheme);
    }
  }, []);
  
  // Theme toggle component
  const ThemeToggle = () => {
    return (
      <div className={`${theme.toggle} rounded-full p-1 flex items-center space-x-1 shadow-md`}>
        <button 
          onClick={() => handleThemeToggle('auto')} 
          className={`rounded-full p-2 ${themePreference === 'auto' ? theme.activeToggle : ''}`}
          aria-label="Auto theme"
          title="Auto"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${theme.auto}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
        <button 
          onClick={() => handleThemeToggle('light')} 
          className={`rounded-full p-2 ${themePreference === 'light' ? theme.activeToggle : ''}`}
          aria-label="Light theme"
          title="Light mode"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${theme.sun}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        </button>
        <button 
          onClick={() => handleThemeToggle('dark')} 
          className={`rounded-full p-2 ${themePreference === 'dark' ? theme.activeToggle : ''}`}
          aria-label="Dark theme"
          title="Dark mode"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${theme.moon}`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className={`${theme.background} ${theme.text} min-h-screen font-sans p-8 relative overflow-hidden`}>
      {/* Cosmic stars */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
        {/* Original stars */}
        <div className={`absolute top-8 right-[10%] w-4 h-4 rounded-full ${theme.starBigBg} shadow-lg ${theme.starBigShadow}`}></div>
        <div className={`absolute top-16 left-[20%] w-2 h-2 rounded-full ${theme.starMediumBg} shadow-sm ${theme.starMediumShadow}`}></div>
        
        {/* New stars throughout the page */}
        <div className={`absolute top-[15%] right-[20%] w-1.5 h-1.5 rounded-full ${theme.starSmallBg} shadow-sm ${theme.starSmallShadow}`}></div>
        <div className={`absolute top-[40%] left-[15%] w-1 h-1 rounded-full ${theme.starTinyBg} shadow-sm ${theme.starTinyShadow}`}></div>
        <div className={`absolute top-[60%] left-[40%] w-2 h-2 rounded-full ${theme.starMediumBg} shadow-sm ${theme.starMediumShadow}`}></div>
        <div className={`absolute top-[75%] right-[45%] w-1 h-1 rounded-full ${theme.starTinyBg} shadow-sm ${theme.starTinyShadow}`}></div>
        <div className={`absolute top-[30%] left-[8%] w-3 h-3 rounded-full ${theme.starBigBg} shadow-sm ${theme.starBigShadow}`}></div>
        <div className={`absolute top-[85%] right-[15%] w-1.5 h-1.5 rounded-full ${theme.starSmallBg} shadow-sm ${theme.starSmallShadow}`}></div>
        <div className={`absolute top-[50%] left-[60%] w-1 h-1 rounded-full ${theme.starTinyBg} shadow-sm ${theme.starTinyShadow}`}></div>
      </div>
      
      <div className="max-w-6xl mx-auto relative z-10">
        {selectedSubnet && (
          <div className="fixed top-4 right-4 bg-yellow-500 text-black px-3 py-1 rounded-md shadow-lg z-50 animate-pulse">
            Subnet /{selectedSubnet.prefix} selected
          </div>
        )}
        {/* Header */}
        <div className="flex flex-col items-center mb-6 relative">
          <h1 className="text-3xl font-bold text-center">
            <span className={`${theme.accent}`}>✨ Cosmic</span> CIDR Subnet Calculator
          </h1>
          
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
        </div>
        
        {/* Two column layout for CIDR input and Available Subnets */}
        <div className="flex flex-col md:flex-row gap-8 mb-8">
          {/* CIDR Input - Left column */}
          <div className="md:w-1/3">
            <div className={`${theme.panel} ${theme.border} border rounded-lg p-6 h-full shadow-lg`}>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <span className="w-3 h-3 rounded-full bg-purple-400 mr-2"></span>
                Network Configuration
              </h2>
              
              <div className={`mb-2 text-xs ${theme.instructions}`}>
                <span>• Enter a CIDR block (max /16)</span>
              </div>
              <label className="block mb-2 font-semibold">CIDR Block:</label>
              <div className="flex items-center">
                <input
                  type="text"
                  value={cidr}
                  onChange={handleCidrChange}
                  className={`${theme.input} border rounded px-3 py-2 w-full mr-4 ${theme.text} focus:outline-none focus:ring-2 focus:ring-purple-500`}
                  placeholder="e.g. 10.0.0.0/16"
                />
              </div>
              {!isValidInput && (
                <p className="text-red-400 mt-2">
                  Please enter a valid CIDR (e.g. 10.0.0.0/16). Maximum prefix is /16.
                </p>
              )}
              {normalizedCidr && normalizedCidr !== cidr && isValidInput && (
                <p className="text-amber-400 mt-2">
                  Normalized to network boundary: {normalizedCidr}
                </p>
              )}
              {baseRange && (
                <div className="mt-2 text-sm">
                  <p>Range: {intToIp(baseRange.start)} - {intToIp(baseRange.end)}</p>
                  <p>Available IPs: {baseRange.size.toLocaleString()}</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Available Subnets - Right column */}
          <div className="md:w-2/3">
            <div className={`${theme.panel} ${theme.border} border rounded-lg p-6 h-full shadow-lg`}>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <span className="w-3 h-3 rounded-full bg-indigo-500 mr-2"></span>
                Available Subnets
              </h2>
              
              <div className={`mb-2 text-xs ${theme.instructions}`}>
                <span className="mr-4">• Click subnet to select, or drag and drop directly onto IP bar</span>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <div className="w-full">
                  <h3 className={`text-sm mb-2 font-medium ${theme.accent}`}>Available Subnet Sizes</h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-6 gap-2">
                    {availableSubnets.map(subnet => renderSubnetBlock(subnet))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* CIDR Bar and Placed Subnets */}
        <div className="w-full">
          <div className={`${theme.panel} ${theme.border} border rounded-lg p-6 mb-8 shadow-lg`}>
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="w-3 h-3 rounded-full bg-purple-500 mr-2"></span>
              IP Space Allocation
            </h2>
            
            <div className={`mb-2 text-xs ${theme.instructions}`}>
              <span className="mr-4">• Drop selected subnet onto the IP bar</span>
              <span className="mr-4">• Double-click subnet to remove it</span>
              <span className="mr-4">• Green highlights show valid position boundaries</span>
              <span className="mr-4">• Drag existing subnets to reposition them</span>
            </div>
            
            {/* CIDR Bar with surrounding container for labels */}
            <div className="relative mt-6 pb-6"> {/* Minimal padding for subnet labels */}
              {/* CIDR range start and end labels */}
              {baseRange && (
                <div className={`w-full mb-1 flex justify-between text-xs font-medium ${theme.ipLabels}`}>
                  <span>{intToIp(baseRange.start)}</span>
                  <span>{intToIp(baseRange.end)}</span>
                </div>
              )}
              
              {/* CIDR Bar */}
              <div 
                ref={cidrBarRef}
                className={`cidr-bar relative h-10 ${theme.highlight} rounded-md overflow-hidden ${selectedSubnet ? 'cursor-pointer' : ''}`}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onClick={handleBarClick}
              >
                {/* Valid Drop Positions Indicators */}
                {validDropPositions.map((position, index) => (
                  <div 
                    key={`valid-${index}`}
                    className="absolute bg-green-400 bg-opacity-20 border border-green-400 border-dashed"
                    style={{ 
                      left: `${position.left}px`, 
                      width: `${position.width}px`,
                      height: '100%',
                      top: 0,
                      zIndex: 5
                    }}
                  />
                ))}
                
                {/* Placed subnets */}
                {baseRange && placedSubnets.map((subnet, index) => renderPlacedSubnet(subnet, index))}
                
                {/* Drop preview */}
                {dragPreview && (
                  <div 
                    className="absolute bg-white bg-opacity-30 border border-white border-dashed"
                    style={{ 
                      left: `${dragPreview.left}px`, 
                      width: `${dragPreview.width}px`,
                      height: '100%',
                      top: 0,
                      zIndex: 10
                    }}
                  />
                )}
              </div>
            </div>
            
            {/* Allocation summary */}
            <div className="flex items-center mt-4">
              <div className={`w-full ${theme.progressBarBg} rounded-full h-2.5`}>
                <div 
                  className={`${theme.progressBar} h-2.5 rounded-full`}
                  style={{ width: `${calculateAllocatedPercentage()}%` }}
                ></div>
              </div>
              <span className="ml-2 min-w-16 text-right">{calculateAllocatedPercentage()}% used</span>
            </div>
          </div>
          
          {/* Summary Table */}
          <div className={`${theme.panel} ${theme.border} border rounded-lg p-6 shadow-lg`}>
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="w-3 h-3 rounded-full bg-teal-500 mr-2"></span>
              Subnet Allocation Summary
            </h2>
            
            <div className={`mb-2 text-xs ${theme.instructions}`}>
              <span className="mr-4">• Double-click subnet row to remove it</span>
              <span className="mr-4">• Click the colored type label to change subnet type</span>
            </div>
            
            {placedSubnets.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-2 text-center">Subnet</th>
                      <th className="px-4 py-2 text-left">CIDR</th>
                      <th className="px-4 py-2 text-left">Network</th>
                      <th className="px-4 py-2 text-left">First IP</th>
                      <th className="px-4 py-2 text-left">Last IP</th>
                      <th className="px-4 py-2 text-right">Available IPs</th>
                      <th className="px-4 py-2 text-center w-24">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placedSubnets.map((subnet, index) => {
                      const subnetNumbers = getOrderedSubnetNumbers();
                      const subnetNumber = subnetNumbers[index] || index + 1;
                      return (
                        <tr 
                          key={index} 
                          className={`border-b ${theme.text === 'text-slate-800' ? 'border-slate-300 hover:bg-slate-100' : 'border-gray-700 hover:bg-gray-800'}`}
                        >
                          <td className="px-4 py-2 text-center font-bold cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{subnetNumber}</td>
                          <td className="px-4 py-2 cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{intToIp(subnet.start)}/{subnet.prefix}</td>
                          <td className="px-4 py-2 cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{intToIp(subnet.start)}</td>
                          <td className="px-4 py-2 cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{intToIp(subnet.start + 1)}</td>
                          <td className="px-4 py-2 cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{intToIp(subnet.end - 1)}</td>
                          <td className="px-4 py-2 text-right cursor-pointer" onDoubleClick={() => handleRemoveSubnet(index)} title="Double-click to remove subnet">{(subnet.size - 2).toLocaleString()}</td>
                          <td className="px-4 py-2 text-center w-24">
                            <span 
                              className={`inline-block px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors duration-200 hover:opacity-80 w-16 text-center flex items-center justify-center
                                ${subnet.type === 'public' ? 'bg-indigo-900 text-indigo-200' : 
                                subnet.type === 'private' ? 'bg-emerald-900 text-emerald-200' : 
                                'bg-rose-900 text-rose-200'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleChangeSubnetType(index);
                              }}
                              title="Click to change type"
                            >
                              {subnet.type}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-400 italic">No subnets allocated yet. Drag and drop subnet blocks to get started.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FixedSubnetCalculator;