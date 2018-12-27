def maxPointOnSameLine(points)

    length = points.length
    slopeMap = []
    maxPoint = 0
    return length if length < 2
 
    for i in 0...length-1
        curMax = overlapPoints = verticalPoints = 0
        for j in j=i+1...length-1
            if (points[i] == points[j])
                overlapPoints+=1
            elsif (points[i][0] == points[j][0])
                verticalPoints+=1
            else
                xDif = points[j][0] - points[i][0]
                yDif = points[j][1] - points[i][1]
                g = gcd(xDif, yDif)
 
                #reducing the difference by their gcd
                yDif /= g
                xDif /= g
                
                curMax = slopeMap.push([yDif, xDif]).max
            end

            curMax = [curMax, verticalPoints].flatten.max
        end
 
        maxPoint = [maxPoint, curMax + overlapPoints + 1].flatten.max
    end
    return maxPoint
end

def gcd(a, b)
  b == 0 ? a : gcd(b, a.modulo(b))
end

    arr = [[-1, 1], [0, 0], [1, 1], [2, 2],[3, 3], [3, 4]]
    #arr = [[0, 0], [1, 1], [2, 2], [3, 3], [3, 2], [4, 2], [5, 1]] 
    puts maxPointOnSameLine(arr)
